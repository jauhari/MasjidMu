/**
 * Perubahan Aset Neto (PSAK 45 — Statement of Changes in Net Assets).
 *
 * Aset Neto = Equity + (cumulative Income − cumulative Expense).
 *
 * For a period [start, end]:
 *   opening   = aset neto before `start` (cumulative ≤ start_month − 1)
 *   surplus   = pendapatan − beban DALAM periode
 *   closing   = aset neto cumulative ≤ end
 *
 * Identity: closing = opening + surplus.
 *
 * Per-equity-account breakdown is also returned for the UI table.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type { NetAssetsChangeData, ReportPeriod } from '../types.js';

interface PointBalance {
  account_code: string;
  account_name: string;
  account_type: string;
  net: string;
}

async function balancesUpTo(
  tenantId: string,
  before: Date,
  inclusive: boolean,
): Promise<PointBalance[]> {
  return withTenant(tenantId, async (tx) => {
    const op = inclusive ? sql`<=` : sql`<`;
    const r = await tx.execute(sql`
      SELECT account_code,
             account_name,
             account_type::text AS account_type,
             COALESCE(SUM(net_movement), 0)::text AS net
        FROM mv_account_balances
       WHERE tenant_id = ${tenantId}
         AND period_month ${op} date_trunc('month', ${before.toISOString()}::timestamptz)
         AND account_type IN ('equity', 'income', 'expense')
       GROUP BY account_code, account_name, account_type
    `);
    return r.rows as unknown as PointBalance[];
  });
}

function netAssetsTotal(rows: PointBalance[]): Decimal {
  let t = new Decimal(0);
  for (const r of rows) {
    if (r.account_type === 'expense') t = t.minus(r.net);
    else t = t.plus(r.net);
  }
  return t;
}

async function periodSurplus(tenantId: string, p: ReportPeriod): Promise<Decimal> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT
        COALESCE(SUM(net_movement) FILTER (WHERE account_type = 'income'), 0)::text  AS income,
        COALESCE(SUM(net_movement) FILTER (WHERE account_type = 'expense'), 0)::text AS expense
        FROM mv_account_balances
       WHERE tenant_id = ${tenantId}
         AND period_month BETWEEN date_trunc('month', ${p.startDate.toISOString()}::timestamptz)
                              AND date_trunc('month', ${p.endDate.toISOString()}::timestamptz)
    `);
    const row = r.rows[0] as { income: string; expense: string };
    return new Decimal(row.income).minus(row.expense);
  });
}

export async function buildNetAssetsChange(args: {
  tenantId: string;
  period: ReportPeriod;
  comparePeriod?: ReportPeriod;
}): Promise<NetAssetsChangeData> {
  const { tenantId, period, comparePeriod } = args;

  // Opening = before start_month (exclusive of the period itself).
  const opening = await balancesUpTo(tenantId, period.startDate, false);
  const closing = await balancesUpTo(tenantId, period.endDate, true);
  const surplus = await periodSurplus(tenantId, period);

  const openingTotal = netAssetsTotal(opening);
  const closingTotal = netAssetsTotal(closing);

  // Per-equity breakdown.
  const equityCodes = new Set([
    ...opening.filter((r) => r.account_type === 'equity').map((r) => r.account_code),
    ...closing.filter((r) => r.account_type === 'equity').map((r) => r.account_code),
  ]);
  const byEquity = [];
  for (const code of equityCodes) {
    const o = opening.find((r) => r.account_code === code && r.account_type === 'equity');
    const c = closing.find((r) => r.account_code === code && r.account_type === 'equity');
    const ref = c ?? o!;
    const oVal = o ? new Decimal(o.net) : new Decimal(0);
    const cVal = c ? new Decimal(c.net) : new Decimal(0);
    byEquity.push({
      accountCode: code,
      accountName: ref.account_name,
      opening: oVal.toFixed(2),
      movement: cVal.minus(oVal).toFixed(2),
      closing: cVal.toFixed(2),
    });
  }
  byEquity.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const result: NetAssetsChangeData = {
    openingBalance: openingTotal.toFixed(2),
    surplusDeficit: surplus.toFixed(2),
    closingBalance: closingTotal.toFixed(2),
    byEquityAccount: byEquity,
  };

  if (comparePeriod) {
    const cOpening = await balancesUpTo(tenantId, comparePeriod.startDate, false);
    const cClosing = await balancesUpTo(tenantId, comparePeriod.endDate, true);
    const cSurplus = await periodSurplus(tenantId, comparePeriod);
    result.compareOpeningBalance = netAssetsTotal(cOpening).toFixed(2);
    result.compareClosingBalance = netAssetsTotal(cClosing).toFixed(2);
    result.compareSurplusDeficit = cSurplus.toFixed(2);
  }

  return result;
}
