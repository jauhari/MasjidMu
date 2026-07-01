/**
 * Laporan Sumber & Penggunaan Dana (PSAK 109).
 *
 * Per dana, roll-forward saldo:
 *   saldo awal  = akumulasi (penerimaan − penyaluran) SEBELUM periode
 *   penerimaan  = Σ kredit ke akun pendapatan (income) ditag dana, DALAM periode
 *   penyaluran  = Σ debit  ke akun beban (expense)    ditag dana, DALAM periode
 *   surplus     = penerimaan − penyaluran
 *   saldo akhir = saldo awal + surplus
 *
 * Hanya baris yang menyentuh akun pendapatan/beban yang dihitung sebagai
 * sumber/penggunaan — sisi kas/aset diabaikan agar tidak dobel hitung.
 *
 * Query langsung ke tabel dasar (bukan v_general_ledger) karena view itu
 * dibuat sebelum kolom fund_id ada. RLS pada journals/journal_lines/accounts/
 * funds tetap menjaga isolasi tenant; predikat tenant_id eksplisit untuk
 * kejelasan & pemanfaatan indeks.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type { FundUsageData, FundUsageRow, ReportPeriod } from '../types.js';

interface Row {
  fund_code: string;
  fund_name: string;
  fund_type: string;
  is_restricted: boolean;
  open_in: string;
  open_out: string;
  penerimaan: string;
  penyaluran: string;
}

export async function buildFundUsage(args: {
  tenantId: string;
  period: ReportPeriod;
}): Promise<FundUsageData> {
  const { tenantId, period } = args;
  const start = period.startDate.toISOString();
  const end = period.endDate.toISOString();

  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT
        f.code AS fund_code,
        f.name AS fund_name,
        f.fund_type::text AS fund_type,
        f.is_restricted,
        COALESCE(SUM(jl.credit) FILTER (
          WHERE a.account_type = 'income'  AND j.journal_date <  ${start}::timestamptz
        ), 0)::text AS open_in,
        COALESCE(SUM(jl.debit)  FILTER (
          WHERE a.account_type = 'expense' AND j.journal_date <  ${start}::timestamptz
        ), 0)::text AS open_out,
        COALESCE(SUM(jl.credit) FILTER (
          WHERE a.account_type = 'income'
            AND j.journal_date BETWEEN ${start}::timestamptz AND ${end}::timestamptz
        ), 0)::text AS penerimaan,
        COALESCE(SUM(jl.debit)  FILTER (
          WHERE a.account_type = 'expense'
            AND j.journal_date BETWEEN ${start}::timestamptz AND ${end}::timestamptz
        ), 0)::text AS penyaluran
      FROM funds f
      LEFT JOIN journal_lines jl ON jl.fund_id = f.id
      LEFT JOIN journals j       ON j.id = jl.journal_id
      LEFT JOIN accounts a       ON a.id = jl.account_id
      WHERE f.tenant_id = ${tenantId}
        AND f.deleted_at IS NULL
      GROUP BY f.id, f.code, f.name, f.fund_type, f.is_restricted, f.sort_order
      ORDER BY f.sort_order, f.code
    `);

    let totalOpening = new Decimal(0);
    let totalPenerimaan = new Decimal(0);
    let totalPenyaluran = new Decimal(0);

    const funds: FundUsageRow[] = (r.rows as unknown as Row[]).map((row) => {
      const opening = new Decimal(row.open_in).minus(row.open_out);
      const penerimaan = new Decimal(row.penerimaan);
      const penyaluran = new Decimal(row.penyaluran);
      const surplus = penerimaan.minus(penyaluran);
      const closing = opening.plus(surplus);

      totalOpening = totalOpening.plus(opening);
      totalPenerimaan = totalPenerimaan.plus(penerimaan);
      totalPenyaluran = totalPenyaluran.plus(penyaluran);

      return {
        fundCode: row.fund_code,
        fundName: row.fund_name,
        fundType: row.fund_type,
        isRestricted: row.is_restricted,
        openingBalance: opening.toFixed(2),
        penerimaan: penerimaan.toFixed(2),
        penyaluran: penyaluran.toFixed(2),
        surplusDeficit: surplus.toFixed(2),
        closingBalance: closing.toFixed(2),
      };
    });

    const totalSurplus = totalPenerimaan.minus(totalPenyaluran);

    return {
      funds,
      totalOpening: totalOpening.toFixed(2),
      totalPenerimaan: totalPenerimaan.toFixed(2),
      totalPenyaluran: totalPenyaluran.toFixed(2),
      totalSurplusDeficit: totalSurplus.toFixed(2),
      totalClosing: totalOpening.plus(totalSurplus).toFixed(2),
    };
  });
}
