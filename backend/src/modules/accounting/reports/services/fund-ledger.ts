/**
 * Buku Dana — detail penerimaan & penyaluran SATU dana dalam periode.
 *
 * Cocok untuk laporan khusus kampanye/program, mis. "Infaq Rutin PAP":
 *   - saldo awal (roll-forward sebelum periode)
 *   - daftar baris masuk (kredit akun pendapatan + fund_id)
 *   - daftar baris keluar (debit akun beban + fund_id)
 *   - saldo akhir + running balance
 *
 * Hanya baris jurnal yang menyentuh akun income/expense + fund_id yang
 * dihitung — sama aturan dengan Sumber & Penggunaan Dana.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type { FundLedgerData, FundLedgerMovement, ReportPeriod } from '../types.js';

interface FundMetaRow {
  fund_id: string;
  fund_code: string;
  fund_name: string;
  fund_type: string;
  is_restricted: boolean;
}

interface OpenRow {
  open_in: string;
  open_out: string;
}

interface MoveRow {
  journal_id: string;
  journal_no: string;
  journal_date: string;
  description: string | null;
  account_code: string;
  account_name: string;
  direction: 'penerimaan' | 'penyaluran';
  amount: string;
  transaction_id: string | null;
  transaction_no: string | null;
}

export async function buildFundLedger(args: {
  tenantId: string;
  period: ReportPeriod;
  fundId: string;
}): Promise<FundLedgerData> {
  const { tenantId, period, fundId } = args;
  const start = period.startDate.toISOString();
  const end = period.endDate.toISOString();

  return withTenant(tenantId, async (tx) => {
    const metaRes = await tx.execute(sql`
      SELECT
        f.id AS fund_id,
        f.code AS fund_code,
        f.name AS fund_name,
        f.fund_type::text AS fund_type,
        f.is_restricted
      FROM funds f
      WHERE f.id = ${fundId}::uuid
        AND f.tenant_id = ${tenantId}
        AND f.deleted_at IS NULL
      LIMIT 1
    `);
    const meta = (metaRes.rows as unknown as FundMetaRow[])[0];
    if (!meta) {
      throw new FundLedgerNotFoundError(fundId);
    }

    const openRes = await tx.execute(sql`
      SELECT
        COALESCE(SUM(jl.credit) FILTER (
          WHERE a.account_type = 'income' AND j.journal_date < ${start}::timestamptz
        ), 0)::text AS open_in,
        COALESCE(SUM(jl.debit) FILTER (
          WHERE a.account_type = 'expense' AND j.journal_date < ${start}::timestamptz
        ), 0)::text AS open_out
      FROM journal_lines jl
      JOIN journals j ON j.id = jl.journal_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE jl.fund_id = ${fundId}::uuid
        AND j.tenant_id = ${tenantId}
    `);
    const open = (openRes.rows as unknown as OpenRow[])[0] ?? { open_in: '0', open_out: '0' };
    const openingBalance = new Decimal(open.open_in).minus(open.open_out);

    const moveRes = await tx.execute(sql`
      SELECT
        j.id AS journal_id,
        j.journal_no,
        j.journal_date::text AS journal_date,
        COALESCE(
          NULLIF(jl.description, ''),
          NULLIF(j.description, ''),
          NULLIF(t.description, ''),
          ''
        ) AS description,
        a.code AS account_code,
        a.name AS account_name,
        CASE
          WHEN a.account_type = 'income' THEN 'penerimaan'
          ELSE 'penyaluran'
        END AS direction,
        CASE
          WHEN a.account_type = 'income' THEN jl.credit
          ELSE jl.debit
        END::text AS amount,
        t.id AS transaction_id,
        t.transaction_no AS transaction_no
      FROM journal_lines jl
      JOIN journals j ON j.id = jl.journal_id
      JOIN accounts a ON a.id = jl.account_id
      LEFT JOIN transactions t ON t.id = j.transaction_id AND t.deleted_at IS NULL
      WHERE jl.fund_id = ${fundId}::uuid
        AND j.tenant_id = ${tenantId}
        AND j.journal_date BETWEEN ${start}::timestamptz AND ${end}::timestamptz
        AND (
          (a.account_type = 'income' AND jl.credit > 0)
          OR (a.account_type = 'expense' AND jl.debit > 0)
        )
      ORDER BY j.journal_date ASC, j.journal_no ASC, jl.sort_order ASC
    `);

    let running = openingBalance;
    let totalPenerimaan = new Decimal(0);
    let totalPenyaluran = new Decimal(0);

    const movements: FundLedgerMovement[] = (moveRes.rows as unknown as MoveRow[]).map((row) => {
      const amount = new Decimal(row.amount);
      if (row.direction === 'penerimaan') {
        totalPenerimaan = totalPenerimaan.plus(amount);
        running = running.plus(amount);
      } else {
        totalPenyaluran = totalPenyaluran.plus(amount);
        running = running.minus(amount);
      }
      return {
        journalId: row.journal_id,
        journalNo: row.journal_no,
        journalDate: row.journal_date,
        description: row.description || null,
        accountCode: row.account_code,
        accountName: row.account_name,
        direction: row.direction,
        amount: amount.toFixed(2),
        runningBalance: running.toFixed(2),
        transactionId: row.transaction_id,
        transactionNo: row.transaction_no,
      };
    });

    const surplus = totalPenerimaan.minus(totalPenyaluran);
    const closing = openingBalance.plus(surplus);

    return {
      fundId: meta.fund_id,
      fundCode: meta.fund_code,
      fundName: meta.fund_name,
      fundType: meta.fund_type,
      isRestricted: meta.is_restricted,
      openingBalance: openingBalance.toFixed(2),
      totalPenerimaan: totalPenerimaan.toFixed(2),
      totalPenyaluran: totalPenyaluran.toFixed(2),
      surplusDeficit: surplus.toFixed(2),
      closingBalance: closing.toFixed(2),
      movements,
    };
  });
}

export class FundLedgerNotFoundError extends Error {
  constructor(fundId: string) {
    super(`Fund not found: ${fundId}`);
    this.name = 'FundLedgerNotFoundError';
  }
}
