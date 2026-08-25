/**
 * Top transaction categories by amount within a period — used by the
 * general finance transparency summary (posisi kas + kategori terbesar).
 * Groups by transaction_categories (not by COA account) so a thin chart of
 * accounts (e.g. one "Beban Program" account covering everything) doesn't
 * collapse every expense into a single uninformative line.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type { ReportPeriod } from '../types.js';

export interface CategoryAmount {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  amount: string;
}

interface Row {
  category_id: string;
  category_code: string;
  category_name: string;
  direction: 'income' | 'expense';
  total: string;
}

async function fetchTopCategories(tenantId: string, period: ReportPeriod): Promise<Row[]> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT tc.id::text AS category_id,
             tc.code AS category_code,
             tc.name AS category_name,
             tc.direction::text AS direction,
             SUM(t.amount)::text AS total
        FROM transactions t
        JOIN transaction_categories tc ON tc.id = t.category_id
       WHERE t.tenant_id = ${tenantId}
         AND t.status = 'posted'
         AND t.deleted_at IS NULL
         AND t.transaction_date >= ${period.startDate.toISOString()}::timestamptz
         AND t.transaction_date <= ${period.endDate.toISOString()}::timestamptz
       GROUP BY tc.id, tc.code, tc.name, tc.direction
       ORDER BY SUM(t.amount) DESC
    `);
    return r.rows as unknown as Row[];
  });
}

export async function buildTopCategories(args: {
  tenantId: string;
  period: ReportPeriod;
}): Promise<{ income: CategoryAmount[]; expense: CategoryAmount[] }> {
  const rows = await fetchTopCategories(args.tenantId, args.period);
  const toAmount = (r: Row): CategoryAmount => ({
    categoryId: r.category_id,
    categoryCode: r.category_code,
    categoryName: r.category_name,
    amount: new Decimal(r.total).toFixed(2),
  });
  return {
    income: rows.filter((r) => r.direction === 'income').slice(0, 5).map(toAmount),
    expense: rows.filter((r) => r.direction === 'expense').slice(0, 5).map(toAmount),
  };
}
