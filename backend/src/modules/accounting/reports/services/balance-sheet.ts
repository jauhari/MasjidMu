/**
 * Posisi Keuangan (PSAK 45 — Statement of Financial Position).
 *
 * Reads `mv_account_balances` and aggregates per accountType through period_month.
 * Asset balances are cumulative from the start of time → period.endDate
 * (PSAK 45 menampilkan posisi pada akhir periode, bukan movement saja).
 *
 * Net assets = Assets − Liabilities. We expose three sub-totals so the UI
 * can show: Aset / Liabilitas / Aset Neto, and Total Liabilitas + Aset Neto
 * untuk mempermudah cek balance sheet equation.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type {
  BalanceSheetData,
  BalanceSheetSection,
  ReportPeriod,
} from '../types.js';

interface RowAggregate {
  account_code: string;
  account_name: string;
  account_type: string;
  balance: string;
}

/** Cumulative balance per account up to (and including) `endDate`. */
async function fetchBalances(tenantId: string, endDate: Date): Promise<RowAggregate[]> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT account_code,
             account_name,
             account_type::text AS account_type,
             COALESCE(SUM(net_movement), 0)::text AS balance
        FROM mv_account_balances
       WHERE tenant_id = ${tenantId}
         AND period_month <= date_trunc('month', ${endDate.toISOString()}::timestamptz)
       GROUP BY account_code, account_name, account_type
       ORDER BY account_code
    `);
    return r.rows as unknown as RowAggregate[];
  });
}

function pickSection(
  rows: RowAggregate[],
  types: string[],
  label: string,
  compareRows?: RowAggregate[],
): BalanceSheetSection {
  const rowsBy = (rs: RowAggregate[]) =>
    new Map(rs.filter((r) => types.includes(r.account_type)).map((r) => [r.account_code, r]));
  const main = rowsBy(rows);
  const cmp = compareRows ? rowsBy(compareRows) : null;
  let total = new Decimal(0);
  let cmpTotal = new Decimal(0);
  const lines = [];
  for (const r of main.values()) {
    const bal = new Decimal(r.balance);
    total = total.plus(bal);
    const cmpRow = cmp?.get(r.account_code);
    const cmpBal = cmpRow ? new Decimal(cmpRow.balance) : null;
    if (cmpBal) cmpTotal = cmpTotal.plus(cmpBal);
    lines.push({
      accountCode: r.account_code,
      accountName: r.account_name,
      amount: bal.toFixed(2),
      ...(cmpBal && { compareAmount: cmpBal.toFixed(2) }),
    });
  }
  // include codes that exist only in the compare set
  if (cmp) {
    for (const r of cmp.values()) {
      if (main.has(r.account_code)) continue;
      const cmpBal = new Decimal(r.balance);
      cmpTotal = cmpTotal.plus(cmpBal);
      lines.push({
        accountCode: r.account_code,
        accountName: r.account_name,
        amount: '0.00',
        compareAmount: cmpBal.toFixed(2),
      });
    }
  }
  lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  return {
    label,
    lines,
    total: total.toFixed(2),
    ...(compareRows && { compareTotal: cmpTotal.toFixed(2) }),
  };
}

export async function buildBalanceSheet(args: {
  tenantId: string;
  period: ReportPeriod;
  comparePeriod?: ReportPeriod;
}): Promise<BalanceSheetData> {
  const { tenantId, period, comparePeriod } = args;
  const main = await fetchBalances(tenantId, period.endDate);
  const cmp = comparePeriod ? await fetchBalances(tenantId, comparePeriod.endDate) : undefined;

  const assets = pickSection(main, ['asset', 'contra_asset'], 'Aset', cmp);
  const liabilities = pickSection(main, ['liability', 'contra_liability'], 'Liabilitas', cmp);

  // Net assets = (income − expense) cumulative + equity accounts.
  // mv_account_balances net_movement already signed by normal_balance, so
  // summing (equity + income − expense) under "credit-normal" gives the net.
  const incomeRows = main.filter((r) => r.account_type === 'income');
  const expenseRows = main.filter((r) => r.account_type === 'expense');
  const equityRows = main.filter((r) => r.account_type === 'equity');

  const netLines = [
    ...equityRows.map((r) => ({
      accountCode: r.account_code,
      accountName: r.account_name,
      amount: new Decimal(r.balance).toFixed(2),
    })),
    {
      accountCode: '___SURPLUS',
      accountName: 'Surplus/Defisit Berjalan',
      amount: incomeRows
        .reduce((acc, r) => acc.plus(r.balance), new Decimal(0))
        .minus(expenseRows.reduce((acc, r) => acc.plus(r.balance), new Decimal(0)))
        .toFixed(2),
    },
  ];
  const netTotal = netLines.reduce((acc, l) => acc.plus(l.amount), new Decimal(0));
  const netAssets: BalanceSheetSection = {
    label: 'Aset Neto',
    lines: netLines,
    total: netTotal.toFixed(2),
  };

  if (cmp) {
    const cmpIncome = cmp.filter((r) => r.account_type === 'income');
    const cmpExpense = cmp.filter((r) => r.account_type === 'expense');
    const cmpEquity = cmp.filter((r) => r.account_type === 'equity');
    const cmpNetLines = [
      ...cmpEquity.map((r) => ({
        accountCode: r.account_code,
        amount: new Decimal(r.balance).toFixed(2),
      })),
      {
        accountCode: '___SURPLUS',
        amount: cmpIncome
          .reduce((acc, r) => acc.plus(r.balance), new Decimal(0))
          .minus(cmpExpense.reduce((acc, r) => acc.plus(r.balance), new Decimal(0)))
          .toFixed(2),
      },
    ];
    const cmpByCode = new Map(cmpNetLines.map((l) => [l.accountCode, l.amount]));
    netAssets.lines = netAssets.lines.map((l) => ({
      ...l,
      compareAmount: cmpByCode.get(l.accountCode) ?? '0.00',
    }));
    // include codes only in cmp
    for (const cl of cmpNetLines) {
      if (netAssets.lines.find((l) => l.accountCode === cl.accountCode)) continue;
      const cmpRow = cmp.find((r) => r.account_code === cl.accountCode);
      netAssets.lines.push({
        accountCode: cl.accountCode,
        accountName: cmpRow?.account_name ?? 'Surplus/Defisit Berjalan',
        amount: '0.00',
        compareAmount: cl.amount,
      });
    }
    netAssets.compareTotal = cmpNetLines
      .reduce((acc, l) => acc.plus(l.amount), new Decimal(0))
      .toFixed(2);
  }

  const liabPlusNet = new Decimal(liabilities.total).plus(netAssets.total).toFixed(2);
  const compareLiabPlusNet =
    cmp && liabilities.compareTotal && netAssets.compareTotal
      ? new Decimal(liabilities.compareTotal).plus(netAssets.compareTotal).toFixed(2)
      : undefined;

  return {
    assets,
    liabilities,
    netAssets,
    totalLiabilitiesAndNetAssets: liabPlusNet,
    ...(compareLiabPlusNet && { compareTotalLiabilitiesAndNetAssets: compareLiabPlusNet }),
  };
}
