/**
 * Trial Balance — per-account cumulative debit & credit ≤ period.endDate.
 *
 * Uses the raw v_trial_balance view so date filtering happens in SQL.
 *
 * Output: every account with non-zero activity, with totalDebit/totalCredit
 * placed under the column matching its normal balance.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type { ReportPeriod, TrialBalanceData } from '../types.js';

interface Row {
  account_code: string;
  account_name: string;
  account_type: string;
  normal_balance: 'debit' | 'credit';
  sum_debit: string;
  sum_credit: string;
}

export async function buildTrialBalance(args: {
  tenantId: string;
  period: ReportPeriod;
}): Promise<TrialBalanceData> {
  const { tenantId, period } = args;
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT account_code,
             account_name,
             account_type::text  AS account_type,
             normal_balance::text AS normal_balance,
             COALESCE(SUM(debit),  0)::text AS sum_debit,
             COALESCE(SUM(credit), 0)::text AS sum_credit
        FROM v_trial_balance
       WHERE tenant_id = ${tenantId}
         AND journal_date <= ${period.endDate.toISOString()}::timestamptz
       GROUP BY account_code, account_name, account_type, normal_balance
       HAVING COALESCE(SUM(debit), 0) <> 0
           OR COALESCE(SUM(credit), 0) <> 0
       ORDER BY account_code
    `);

    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    const lines = (r.rows as unknown as Row[]).map((row) => {
      const d = new Decimal(row.sum_debit);
      const c = new Decimal(row.sum_credit);
      const net = row.normal_balance === 'debit' ? d.minus(c) : c.minus(d);
      const debitCol = row.normal_balance === 'debit' && net.gt(0) ? net : new Decimal(0);
      const creditCol = row.normal_balance === 'credit' && net.gt(0) ? net : new Decimal(0);
      totalDebit = totalDebit.plus(debitCol);
      totalCredit = totalCredit.plus(creditCol);
      return {
        accountCode: row.account_code,
        accountName: row.account_name,
        accountType: row.account_type,
        debit: debitCol.toFixed(2),
        credit: creditCol.toFixed(2),
      };
    });

    return {
      lines,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
    };
  });
}
