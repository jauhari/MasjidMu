/**
 * Konsolidasi Multi-Entitas — Sumber & Penggunaan Dana (PSAK 109).
 *
 * Untuk tenant induk (mis. LazisNu pusat / BAZNAS provinsi): agregasi dana
 * lintas {induk + semua cabang}.
 *
 * ── Keamanan lintas-tenant ──────────────────────────────────────────────
 * RLS mengisolasi per-tenant, jadi konsolidasi WAJIB membaca beberapa tenant.
 * Kita pakai `asSuperAdmin` (bypass RLS) TAPI dibatasi tegas:
 *   - daftar tenant = HANYA induk + cabang yang `parent_tenant_id = induk`
 *   - resolusi cabang dilakukan di sini, bukan dari input user
 * sehingga induk hanya bisa melihat cabangnya sendiri. Pemanggil (route)
 * tetap menggunakan tenantId dari konteks sesi sebagai induk.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { asSuperAdmin } from '../../../../db/client.js';
import type {
  ConsolidatedEntityRow,
  ConsolidatedFundRow,
  ConsolidatedFundUsageData,
  ReportPeriod,
} from '../types.js';

const FUND_TYPE_LABELS: Record<string, string> = {
  zakat: 'Dana Zakat',
  infaq_sedekah: 'Dana Infak/Sedekah',
  amil: 'Dana Amil',
  nonhalal: 'Dana Non-halal',
  wakaf: 'Dana Wakaf',
  umum: 'Dana Umum',
};

interface FundRow {
  fund_type: string;
  open_in: string;
  open_out: string;
  penerimaan: string;
  penyaluran: string;
}

interface EntityRow {
  tenant_id: string;
  tenant_name: string;
  penerimaan: string;
  penyaluran: string;
  close_in: string;
  close_out: string;
}

export async function buildConsolidatedFundUsage(args: {
  parentTenantId: string;
  period: ReportPeriod;
}): Promise<ConsolidatedFundUsageData> {
  const { parentTenantId, period } = args;
  const start = period.startDate.toISOString();
  const end = period.endDate.toISOString();

  return asSuperAdmin(async (tx) => {
    // 1. Resolusi scope: induk + cabang langsung (non-deleted). Diturunkan di
    //    server, bukan dari input → induk hanya melihat cabangnya sendiri.
    const scope = await tx.execute(sql`
      SELECT id::text AS id
        FROM tenants
       WHERE deleted_at IS NULL
         AND (id = ${parentTenantId} OR parent_tenant_id = ${parentTenantId})
    `);
    const ids = (scope.rows as unknown as { id: string }[]).map((r) => r.id);
    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );

    // 2. Agregasi per jenis dana lintas semua entitas dalam scope.
    const fundRes = await tx.execute(sql`
      SELECT
        f.fund_type::text AS fund_type,
        COALESCE(SUM(jl.credit) FILTER (WHERE a.account_type='income'  AND j.journal_date <  ${start}::timestamptz),0)::text AS open_in,
        COALESCE(SUM(jl.debit)  FILTER (WHERE a.account_type='expense' AND j.journal_date <  ${start}::timestamptz),0)::text AS open_out,
        COALESCE(SUM(jl.credit) FILTER (WHERE a.account_type='income'  AND j.journal_date BETWEEN ${start}::timestamptz AND ${end}::timestamptz),0)::text AS penerimaan,
        COALESCE(SUM(jl.debit)  FILTER (WHERE a.account_type='expense' AND j.journal_date BETWEEN ${start}::timestamptz AND ${end}::timestamptz),0)::text AS penyaluran
      FROM funds f
      LEFT JOIN journal_lines jl ON jl.fund_id = f.id
      LEFT JOIN journals j       ON j.id = jl.journal_id
      LEFT JOIN accounts a       ON a.id = jl.account_id
      WHERE f.tenant_id IN (${idList}) AND f.deleted_at IS NULL
      GROUP BY f.fund_type
    `);

    // 3. Ringkasan per entitas (penerimaan/penyaluran periode + saldo akhir kumulatif).
    const entityRes = await tx.execute(sql`
      SELECT
        t.id::text AS tenant_id,
        t.name AS tenant_name,
        COALESCE(SUM(jl.credit) FILTER (WHERE a.account_type='income'  AND j.journal_date BETWEEN ${start}::timestamptz AND ${end}::timestamptz),0)::text AS penerimaan,
        COALESCE(SUM(jl.debit)  FILTER (WHERE a.account_type='expense' AND j.journal_date BETWEEN ${start}::timestamptz AND ${end}::timestamptz),0)::text AS penyaluran,
        COALESCE(SUM(jl.credit) FILTER (WHERE a.account_type='income'  AND j.journal_date <= ${end}::timestamptz),0)::text AS close_in,
        COALESCE(SUM(jl.debit)  FILTER (WHERE a.account_type='expense' AND j.journal_date <= ${end}::timestamptz),0)::text AS close_out
      FROM tenants t
      LEFT JOIN funds f          ON f.tenant_id = t.id AND f.deleted_at IS NULL
      LEFT JOIN journal_lines jl ON jl.fund_id = f.id
      LEFT JOIN journals j       ON j.id = jl.journal_id
      LEFT JOIN accounts a       ON a.id = jl.account_id
      WHERE t.id IN (${idList})
      GROUP BY t.id, t.name
      ORDER BY t.name
    `);

    let totalOpening = new Decimal(0);
    let totalPenerimaan = new Decimal(0);
    let totalPenyaluran = new Decimal(0);

    const byFundType: ConsolidatedFundRow[] = (fundRes.rows as unknown as FundRow[]).map((row) => {
      const opening = new Decimal(row.open_in).minus(row.open_out);
      const penerimaan = new Decimal(row.penerimaan);
      const penyaluran = new Decimal(row.penyaluran);
      const surplus = penerimaan.minus(penyaluran);
      const closing = opening.plus(surplus);
      totalOpening = totalOpening.plus(opening);
      totalPenerimaan = totalPenerimaan.plus(penerimaan);
      totalPenyaluran = totalPenyaluran.plus(penyaluran);
      return {
        fundType: row.fund_type,
        label: FUND_TYPE_LABELS[row.fund_type] ?? row.fund_type,
        openingBalance: opening.toFixed(2),
        penerimaan: penerimaan.toFixed(2),
        penyaluran: penyaluran.toFixed(2),
        surplusDeficit: surplus.toFixed(2),
        closingBalance: closing.toFixed(2),
      };
    });
    byFundType.sort((a, b) => a.label.localeCompare(b.label));

    const entities: ConsolidatedEntityRow[] = (entityRes.rows as unknown as EntityRow[]).map((row) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      penerimaan: new Decimal(row.penerimaan).toFixed(2),
      penyaluran: new Decimal(row.penyaluran).toFixed(2),
      closingBalance: new Decimal(row.close_in).minus(row.close_out).toFixed(2),
    }));

    const totalSurplus = totalPenerimaan.minus(totalPenyaluran);

    return {
      entityCount: ids.length,
      entities,
      byFundType,
      totalOpening: totalOpening.toFixed(2),
      totalPenerimaan: totalPenerimaan.toFixed(2),
      totalPenyaluran: totalPenyaluran.toFixed(2),
      totalSurplusDeficit: totalSurplus.toFixed(2),
      totalClosing: totalOpening.plus(totalSurplus).toFixed(2),
    };
  });
}
