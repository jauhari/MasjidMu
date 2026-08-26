/**
 * Individual anonymized transaction movements within a period -- powers
 * the "Mutasi" list on the general finance transparency page (shown for
 * a specific period, not for "Semua Data" where the monthly-trend table
 * takes over instead).
 *
 * Privacy: only date, category label, direction, and amount are exposed --
 * no transaction description (can contain donor/recipient names, e.g.
 * "Infaq Bu Rohmi"), voucher number, or account code. Reads account_type
 * from journal lines rather than transaction_categories, so an entry
 * posted to a non income/expense account (e.g. an opening-balance entry
 * against an equity account) is correctly excluded -- it isn't an
 * operational movement, matching how category-breakdown.ts and
 * monthly-trend.ts already treat that same edge case.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type { ReportPeriod } from '../types.js';

export interface PublicMovement {
  date: string;
  direction: 'income' | 'expense';
  label: string;
  amount: string;
}

interface Row {
  transaction_date: string;
  category_name: string | null;
  account_type: 'income' | 'expense';
  net: string;
}

const MAX_MOVEMENTS = 200;

export async function buildMovements(args: { tenantId: string; period: ReportPeriod }): Promise<PublicMovement[]> {
  const { tenantId, period } = args;
  const rows = await withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT t.transaction_date::text AS transaction_date,
             tc.name AS category_name,
             a.account_type::text AS account_type,
             (CASE WHEN a.account_type = 'income' THEN jl.credit - jl.debit ELSE jl.debit - jl.credit END)::text AS net
        FROM transactions t
        JOIN journals j ON j.transaction_id = t.id
        JOIN journal_lines jl ON jl.journal_id = j.id
        JOIN accounts a ON a.id = jl.account_id
        LEFT JOIN transaction_categories tc ON tc.id = t.category_id
       WHERE t.tenant_id = ${tenantId}
         AND t.status = 'posted'
         AND t.deleted_at IS NULL
         AND a.account_type IN ('income', 'expense')
         AND t.transaction_date >= ${period.startDate.toISOString()}::timestamptz
         AND t.transaction_date <= ${period.endDate.toISOString()}::timestamptz
       ORDER BY t.transaction_date, t.id
       LIMIT ${MAX_MOVEMENTS}
    `);
    return r.rows as unknown as Row[];
  });

  return rows.map((r) => ({
    date: r.transaction_date,
    direction: r.account_type,
    label: r.category_name ?? (r.account_type === 'income' ? 'Pemasukan Lain' : 'Pengeluaran Lain'),
    amount: new Decimal(r.net).abs().toFixed(2),
  }));
}
