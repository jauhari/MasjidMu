/**
 * Aktivitas (PSAK 45 — Statement of Activities).
 *
 * Period-bound statement: pendapatan dan beban DALAM periode (bukan kumulatif).
 * Reads `mv_account_balances` and filters by period_month.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type { ActivityData, ActivitySection, ReportPeriod } from '../types.js';

interface Row {
  account_code: string;
  account_name: string;
  account_type: string;
  net: string;
}

async function fetchPeriod(tenantId: string, period: ReportPeriod): Promise<Row[]> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT account_code,
             account_name,
             account_type::text AS account_type,
             COALESCE(SUM(net_movement), 0)::text AS net
        FROM mv_account_balances
       WHERE tenant_id = ${tenantId}
         AND period_month BETWEEN date_trunc('month', ${period.startDate.toISOString()}::timestamptz)
                              AND date_trunc('month', ${period.endDate.toISOString()}::timestamptz)
         AND account_type IN ('income', 'expense')
       GROUP BY account_code, account_name, account_type
       ORDER BY account_code
    `);
    return r.rows as unknown as Row[];
  });
}

function buildSection(
  rows: Row[],
  type: 'income' | 'expense',
  label: string,
  cmpRows?: Row[],
): ActivitySection {
  const main = rows.filter((r) => r.account_type === type);
  const cmpByCode = cmpRows
    ? new Map(cmpRows.filter((r) => r.account_type === type).map((r) => [r.account_code, r]))
    : null;

  let total = new Decimal(0);
  let cmpTotal = new Decimal(0);
  const lines = [];
  for (const r of main) {
    const amt = new Decimal(r.net);
    total = total.plus(amt);
    const cmpRow = cmpByCode?.get(r.account_code);
    const cmpAmt = cmpRow ? new Decimal(cmpRow.net) : null;
    if (cmpAmt) cmpTotal = cmpTotal.plus(cmpAmt);
    lines.push({
      accountCode: r.account_code,
      accountName: r.account_name,
      amount: amt.toFixed(2),
      ...(cmpAmt && { compareAmount: cmpAmt.toFixed(2) }),
    });
  }
  // codes only in cmp
  if (cmpByCode) {
    for (const r of cmpByCode.values()) {
      if (main.find((m) => m.account_code === r.account_code)) continue;
      const cmpAmt = new Decimal(r.net);
      cmpTotal = cmpTotal.plus(cmpAmt);
      lines.push({
        accountCode: r.account_code,
        accountName: r.account_name,
        amount: '0.00',
        compareAmount: cmpAmt.toFixed(2),
      });
    }
    lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  return {
    label,
    lines,
    total: total.toFixed(2),
    ...(cmpRows && { compareTotal: cmpTotal.toFixed(2) }),
  };
}

export async function buildActivity(args: {
  tenantId: string;
  period: ReportPeriod;
  comparePeriod?: ReportPeriod;
}): Promise<ActivityData> {
  const { tenantId, period, comparePeriod } = args;
  const main = await fetchPeriod(tenantId, period);
  const cmp = comparePeriod ? await fetchPeriod(tenantId, comparePeriod) : undefined;

  const income = buildSection(main, 'income', 'Pendapatan', cmp);
  const expense = buildSection(main, 'expense', 'Beban', cmp);
  const surplus = new Decimal(income.total).minus(expense.total).toFixed(2);
  const compareSurplus =
    cmp && income.compareTotal && expense.compareTotal
      ? new Decimal(income.compareTotal).minus(expense.compareTotal).toFixed(2)
      : undefined;

  return {
    income,
    expense,
    surplusDeficit: surplus,
    ...(compareSurplus && { compareSurplusDeficit: compareSurplus }),
  };
}
