/**
 * General Ledger.
 *
 * For each account active in the period, return:
 *   - Opening balance (cumulative before period.startDate)
 *   - Every journal line within the period (chronological)
 *   - Running balance at each line
 *   - Closing balance
 *
 * Optional `accountCode` filter to drill into a single account.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type {
  GeneralLedgerAccount,
  GeneralLedgerData,
  ReportPeriod,
} from '../types.js';

interface AccountRow {
  id: string;
  code: string;
  name: string;
  normal_balance: 'debit' | 'credit';
}

interface LineRow {
  account_id: string;
  account_code: string;
  account_name: string;
  normal_balance: 'debit' | 'credit';
  journal_no: string;
  journal_date: string;
  description: string | null;
  debit: string;
  credit: string;
}

interface OpeningRow {
  account_id: string;
  net: string;
}

export async function buildGeneralLedger(args: {
  tenantId: string;
  period: ReportPeriod;
  accountCode?: string;
}): Promise<GeneralLedgerData> {
  const { tenantId, period, accountCode } = args;
  return withTenant(tenantId, async (tx) => {
    // 1. Active accounts (filtered if accountCode given).
    const accs = await tx.execute(sql`
      SELECT id, code, name, normal_balance::text AS normal_balance
        FROM accounts
       WHERE tenant_id = ${tenantId}
         AND deleted_at IS NULL
         ${accountCode ? sql`AND code = ${accountCode}` : sql``}
       ORDER BY code
    `);
    const accountList = accs.rows as unknown as AccountRow[];
    if (accountList.length === 0) return { accounts: [] };

    // 2. Opening balances per account (cumulative before startDate).
    const opens = await tx.execute(sql`
      SELECT account_id,
             COALESCE(SUM(net_movement), 0)::text AS net
        FROM mv_account_balances
       WHERE tenant_id = ${tenantId}
         AND period_month < date_trunc('month', ${period.startDate.toISOString()}::timestamptz)
         AND account_id = ANY(${sql`ARRAY[${sql.join(accountList.map((a) => sql`${a.id}::uuid`), sql`, `)}]`})
       GROUP BY account_id
    `);
    const openByAcct = new Map((opens.rows as unknown as OpeningRow[]).map((o) => [o.account_id, o.net]));

    // 3. All lines within the period for these accounts.
    const lines = await tx.execute(sql`
      SELECT jl.account_id,
             a.code AS account_code,
             a.name AS account_name,
             a.normal_balance::text AS normal_balance,
             j.journal_no,
             j.journal_date::text AS journal_date,
             j.description,
             jl.debit::text  AS debit,
             jl.credit::text AS credit
        FROM journal_lines jl
        JOIN journals j ON j.id = jl.journal_id
        JOIN accounts a ON a.id = jl.account_id
       WHERE j.tenant_id = ${tenantId}
         AND j.journal_date BETWEEN ${period.startDate.toISOString()}::timestamptz
                                AND ${period.endDate.toISOString()}::timestamptz
         AND a.deleted_at IS NULL
         ${accountCode ? sql`AND a.code = ${accountCode}` : sql``}
       ORDER BY a.code, j.journal_date, j.journal_no, jl.sort_order
    `);
    const linesByAcct = new Map<string, LineRow[]>();
    for (const r of lines.rows as unknown as LineRow[]) {
      const arr = linesByAcct.get(r.account_id) ?? [];
      arr.push(r);
      linesByAcct.set(r.account_id, arr);
    }

    // 4. Build per-account ledger.
    const out: GeneralLedgerAccount[] = [];
    for (const a of accountList) {
      const opening = new Decimal(openByAcct.get(a.id) ?? '0');
      let running = opening;
      const accLines = (linesByAcct.get(a.id) ?? []).map((l) => {
        const d = new Decimal(l.debit);
        const c = new Decimal(l.credit);
        const delta = a.normal_balance === 'debit' ? d.minus(c) : c.minus(d);
        running = running.plus(delta);
        return {
          journalNo: l.journal_no,
          journalDate: l.journal_date,
          description: l.description,
          debit: d.toFixed(2),
          credit: c.toFixed(2),
          runningBalance: running.toFixed(2),
        };
      });
      out.push({
        accountCode: a.code,
        accountName: a.name,
        openingBalance: opening.toFixed(2),
        closingBalance: running.toFixed(2),
        lines: accLines,
      });
    }

    return { accounts: out };
  });
}
