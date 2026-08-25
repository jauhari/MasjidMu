/**
 * Income vs expense per calendar month, across all posted history --
 * powers the "Tren Bulanan" section of the general finance transparency
 * report. Reads journal lines directly (account_type), not
 * transaction_categories, so it stays correct even where categorization
 * is incomplete (see docs/HANDOFF.md 2026-08-25).
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';

export interface MonthlyAmount {
  /** "YYYY-MM" */
  month: string;
  income: string;
  expense: string;
}

interface Row {
  month: string;
  account_type: 'income' | 'expense';
  net: string;
}

export async function buildMonthlyTrend(args: { tenantId: string }): Promise<MonthlyAmount[]> {
  const rows = await withTenant(args.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT to_char(date_trunc('month', t.transaction_date), 'YYYY-MM') AS month,
             a.account_type::text AS account_type,
             SUM(CASE WHEN a.account_type = 'income' THEN jl.credit - jl.debit ELSE jl.debit - jl.credit END)::text AS net
        FROM transactions t
        JOIN journals j ON j.transaction_id = t.id
        JOIN journal_lines jl ON jl.journal_id = j.id
        JOIN accounts a ON a.id = jl.account_id
       WHERE t.tenant_id = ${args.tenantId}
         AND t.status = 'posted'
         AND t.deleted_at IS NULL
         AND a.account_type IN ('income', 'expense')
       GROUP BY month, a.account_type
       ORDER BY month
    `);
    return r.rows as unknown as Row[];
  });

  const byMonth = new Map<string, { income: Decimal; expense: Decimal }>();
  for (const r of rows) {
    const entry = byMonth.get(r.month) ?? { income: new Decimal(0), expense: new Decimal(0) };
    if (r.account_type === 'income') entry.income = entry.income.plus(r.net);
    else entry.expense = entry.expense.plus(r.net);
    byMonth.set(r.month, entry);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      income: v.income.toFixed(2),
      expense: v.expense.toFixed(2),
    }));
}
