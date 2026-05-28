/**
 * Arus Kas (PSAK 45 — Statement of Cash Flows, direct method).
 *
 * MVP scope: every journal entry that touches a cash/bank account counts as
 * an operating cash flow. Investing/financing classification will require
 * tagging at COA level — placeholder sections returned empty for now.
 *
 * Cash accounts = account_type='asset' AND code starts with '11' (PSAK 45
 * default chart convention: 1110/1120/1130 = Kas, Bank, Setara Kas).
 *
 * For each cash account in the period:
 *   inflow  = SUM(debit)  - posted to cash → kas masuk
 *   outflow = SUM(credit) - keluar dari kas → kas keluar
 *
 * Per-counterparty breakdown is keyed off the OTHER side of the journal —
 * for each line on a cash account, look at the journal's other lines and
 * group by their account names (e.g. "Pendapatan Infaq" / "Beban Listrik").
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type { CashFlowData, ReportPeriod } from '../types.js';

interface CashLineRow {
  counter_account_code: string;
  counter_account_name: string;
  counter_account_type: string;
  cash_in: string;
  cash_out: string;
}

async function fetchCashFlow(tenantId: string, p: ReportPeriod): Promise<CashLineRow[]> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      WITH cash_accts AS (
        SELECT id FROM accounts
         WHERE tenant_id = ${tenantId}
           AND deleted_at IS NULL
           AND account_type = 'asset'
           AND code LIKE '11%'
      ),
      cash_journals AS (
        SELECT DISTINCT j.id
          FROM journals j
          JOIN journal_lines jl ON jl.journal_id = j.id
         WHERE j.tenant_id = ${tenantId}
           AND jl.account_id IN (SELECT id FROM cash_accts)
           AND j.journal_date >= ${p.startDate.toISOString()}::timestamptz
           AND j.journal_date <= ${p.endDate.toISOString()}::timestamptz
      ),
      cash_pairs AS (
        SELECT
          j.id           AS journal_id,
          cash_jl.debit  AS cash_debit,
          cash_jl.credit AS cash_credit,
          other_jl.account_id AS counter_account_id
          FROM journals j
          JOIN journal_lines cash_jl  ON cash_jl.journal_id  = j.id
                                      AND cash_jl.account_id IN (SELECT id FROM cash_accts)
          JOIN journal_lines other_jl ON other_jl.journal_id = j.id
                                      AND other_jl.account_id NOT IN (SELECT id FROM cash_accts)
         WHERE j.id IN (SELECT id FROM cash_journals)
      )
      SELECT a.code         AS counter_account_code,
             a.name         AS counter_account_name,
             a.account_type::text AS counter_account_type,
             COALESCE(SUM(cp.cash_debit),  0)::text AS cash_in,
             COALESCE(SUM(cp.cash_credit), 0)::text AS cash_out
        FROM cash_pairs cp
        JOIN accounts a ON a.id = cp.counter_account_id
       GROUP BY a.code, a.name, a.account_type
       ORDER BY a.code
    `);
    return r.rows as unknown as CashLineRow[];
  });
}

async function openingCash(tenantId: string, before: Date): Promise<Decimal> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT COALESCE(SUM(net_movement), 0)::text AS net
        FROM mv_account_balances
       WHERE tenant_id = ${tenantId}
         AND account_type = 'asset'
         AND account_code LIKE '11%'
         AND period_month < date_trunc('month', ${before.toISOString()}::timestamptz)
    `);
    return new Decimal((r.rows[0] as { net: string }).net);
  });
}

async function closingCash(tenantId: string, before: Date): Promise<Decimal> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT COALESCE(SUM(net_movement), 0)::text AS net
        FROM mv_account_balances
       WHERE tenant_id = ${tenantId}
         AND account_type = 'asset'
         AND account_code LIKE '11%'
         AND period_month <= date_trunc('month', ${before.toISOString()}::timestamptz)
    `);
    return new Decimal((r.rows[0] as { net: string }).net);
  });
}

export async function buildCashFlow(args: {
  tenantId: string;
  period: ReportPeriod;
  comparePeriod?: ReportPeriod;
}): Promise<CashFlowData> {
  const { tenantId, period, comparePeriod } = args;
  const rows = await fetchCashFlow(tenantId, period);
  const cmpRows = comparePeriod ? await fetchCashFlow(tenantId, comparePeriod) : undefined;
  const cmpByCode = cmpRows ? new Map(cmpRows.map((r) => [r.counter_account_code, r])) : null;

  const opLines = [];
  let opTotal = new Decimal(0);
  let opCmpTotal = new Decimal(0);
  for (const row of rows) {
    const net = new Decimal(row.cash_in).minus(row.cash_out);
    opTotal = opTotal.plus(net);
    const cmpRow = cmpByCode?.get(row.counter_account_code);
    const cmpNet = cmpRow ? new Decimal(cmpRow.cash_in).minus(cmpRow.cash_out) : null;
    if (cmpNet) opCmpTotal = opCmpTotal.plus(cmpNet);
    opLines.push({
      description: `${row.counter_account_code} ${row.counter_account_name}`,
      amount: net.toFixed(2),
      ...(cmpNet && { compareAmount: cmpNet.toFixed(2) }),
    });
  }
  // codes only in compare
  if (cmpByCode) {
    for (const cr of cmpByCode.values()) {
      if (rows.find((r) => r.counter_account_code === cr.counter_account_code)) continue;
      const cmpNet = new Decimal(cr.cash_in).minus(cr.cash_out);
      opCmpTotal = opCmpTotal.plus(cmpNet);
      opLines.push({
        description: `${cr.counter_account_code} ${cr.counter_account_name}`,
        amount: '0.00',
        compareAmount: cmpNet.toFixed(2),
      });
    }
  }

  const opening = await openingCash(tenantId, period.startDate);
  const closing = await closingCash(tenantId, period.endDate);
  const netChange = closing.minus(opening);

  const result: CashFlowData = {
    operating: {
      lines: opLines,
      total: opTotal.toFixed(2),
      ...(comparePeriod && { compareTotal: opCmpTotal.toFixed(2) }),
    },
    investing: { lines: [], total: '0.00', ...(comparePeriod && { compareTotal: '0.00' }) },
    financing: { lines: [], total: '0.00', ...(comparePeriod && { compareTotal: '0.00' }) },
    netCashChange: netChange.toFixed(2),
    openingCash: opening.toFixed(2),
    closingCash: closing.toFixed(2),
  };

  if (comparePeriod) {
    const cmpOpen = await openingCash(tenantId, comparePeriod.startDate);
    const cmpClose = await closingCash(tenantId, comparePeriod.endDate);
    result.compareOpeningCash = cmpOpen.toFixed(2);
    result.compareClosingCash = cmpClose.toFixed(2);
    result.compareNetCashChange = cmpClose.minus(cmpOpen).toFixed(2);
  }

  return result;
}
