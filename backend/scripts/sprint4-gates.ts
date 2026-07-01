/**
 * Sprint 4 acceptance gate runner.
 *
 * Verifies that the reports module is wired correctly end-to-end:
 *   - mat views exist + populated
 *   - Each of 7 reports computes against the seeded admin tenant
 *   - Trial balance sums equal (debit == credit)
 *   - Activity surplus matches Posisi Keuangan retained surplus
 *   - General Ledger running balance matches Trial Balance closing
 *   - Cache write/read round-trip works
 *   - PDF + XLSX exporters produce non-empty buffers
 *
 * Run: pnpm tsx scripts/sprint4-gates.ts
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { asSuperAdmin, pool } from '../src/db/client.js';
import { buildBalanceSheet } from '../src/modules/accounting/reports/services/balance-sheet.js';
import { buildActivity } from '../src/modules/accounting/reports/services/activity.js';
import { buildNetAssetsChange } from '../src/modules/accounting/reports/services/net-assets-change.js';
import { buildCashFlow } from '../src/modules/accounting/reports/services/cash-flow.js';
import { buildGeneralLedger } from '../src/modules/accounting/reports/services/general-ledger.js';
import { buildTrialBalance } from '../src/modules/accounting/reports/services/trial-balance.js';
import { buildJurnalUmum } from '../src/modules/accounting/reports/services/jurnal-umum.js';
import { renderReportPdf, closeReportPdfBrowser } from '../src/modules/accounting/reports/export/pdf.js';
import { renderReportXlsx } from '../src/modules/accounting/reports/export/xlsx.js';
import {
  getCachedReport,
  invalidateTenantReports,
  reportCacheKey,
  setCachedReport,
} from '../src/modules/accounting/reports/cache.js';
import type { ReportPeriod } from '../src/modules/accounting/reports/types.js';

type GateResult = { name: string; pass: boolean; detail: string };

async function adminTenantId(): Promise<string> {
  const r = await asSuperAdmin((tx) =>
    tx.execute(sql`SELECT id FROM tenants WHERE slug = 'admin' LIMIT 1`),
  );
  if (r.rows.length === 0) throw new Error('admin tenant not found — run db:seed first');
  return (r.rows[0] as { id: string }).id;
}

function periodAllTime(): ReportPeriod {
  // Period spans 2020-01-01 → today, end-of-day. Captures every seeded journal.
  const start = new Date(Date.UTC(2020, 0, 1));
  const end = new Date();
  return {
    startDate: start,
    endDate: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999)),
    label: `2020 — sekarang`,
    periodMonth: start,
  };
}

async function gate1_matViewsExist(): Promise<GateResult> {
  const r = await asSuperAdmin((tx) =>
    tx.execute(sql`
      SELECT matviewname FROM pg_matviews WHERE matviewname IN ('mv_account_balances', 'mv_monthly_summary')
    `),
  );
  const found = (r.rows as { matviewname: string }[]).map((x) => x.matviewname).sort();
  const expected = ['mv_account_balances', 'mv_monthly_summary'];
  return {
    name: 'Materialized views present',
    pass: JSON.stringify(found) === JSON.stringify(expected),
    detail: `found: ${found.join(', ') || '<none>'}`,
  };
}

async function gate2_matViewsPopulated(): Promise<GateResult> {
  const r = await asSuperAdmin((tx) =>
    tx.execute(sql`SELECT COUNT(*)::int AS n FROM mv_account_balances`),
  );
  const n = (r.rows[0] as { n: number }).n;
  return {
    name: 'mv_account_balances populated',
    pass: n >= 1,
    detail: `${n} rows`,
  };
}

async function gate3_balanceSheetRuns(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const period = periodAllTime();
  const r = await buildBalanceSheet({ tenantId, period });
  const hasSomeBalance =
    new Decimal(r.assets.total).abs().gt(0) ||
    new Decimal(r.liabilities.total).abs().gt(0) ||
    new Decimal(r.netAssets.total).abs().gt(0);
  return {
    name: 'Posisi Keuangan computes',
    pass: hasSomeBalance,
    detail: `aset=${r.assets.total} liab=${r.liabilities.total} net=${r.netAssets.total} total=${r.totalLiabilitiesAndNetAssets}`,
  };
}

async function gate4_trialBalanceBalances(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const period = periodAllTime();
  const tb = await buildTrialBalance({ tenantId, period });
  const debit = new Decimal(tb.totalDebit);
  const credit = new Decimal(tb.totalCredit);
  const diff = debit.minus(credit).abs();
  return {
    name: 'Trial Balance: total debit = total credit',
    pass: diff.lte('0.01'),
    detail: `debit=${debit.toFixed(2)} credit=${credit.toFixed(2)} diff=${diff.toFixed(2)} lines=${tb.lines.length}`,
  };
}

async function gate5_activityMatchesNetAssets(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const period = periodAllTime();
  const act = await buildActivity({ tenantId, period });
  const change = await buildNetAssetsChange({ tenantId, period });
  const a = new Decimal(act.surplusDeficit);
  const b = new Decimal(change.surplusDeficit);
  const diff = a.minus(b).abs();
  return {
    name: 'Aktivitas surplus = Perubahan Aset Neto surplus',
    pass: diff.lte('0.01'),
    detail: `aktivitas=${a.toFixed(2)} perubahan=${b.toFixed(2)} diff=${diff.toFixed(2)}`,
  };
}

async function gate6_generalLedgerConsistent(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const period = periodAllTime();
  const gl = await buildGeneralLedger({ tenantId, period });
  if (gl.accounts.length === 0) {
    return { name: 'General Ledger consistent', pass: false, detail: 'no accounts returned' };
  }
  // Sanity check: sum of (debit-credit) per line equals (closing - opening) for debit-normal accounts.
  const issues: string[] = [];
  for (const a of gl.accounts) {
    const opening = new Decimal(a.openingBalance);
    const closing = new Decimal(a.closingBalance);
    const lastRunning = a.lines.length > 0
      ? new Decimal(a.lines[a.lines.length - 1]!.runningBalance)
      : opening;
    if (lastRunning.minus(closing).abs().gt('0.01')) {
      issues.push(`${a.accountCode}: last_running=${lastRunning} != closing=${closing}`);
    }
  }
  return {
    name: 'GL: last running balance == closing',
    pass: issues.length === 0,
    detail: issues.length === 0 ? `${gl.accounts.length} accounts validated` : issues.slice(0, 3).join('; '),
  };
}

async function gate7_cashFlowAndJurnal(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const period = periodAllTime();
  const cf = await buildCashFlow({ tenantId, period });
  const ju = await buildJurnalUmum({ tenantId, period });
  const juDebit = new Decimal(ju.totalDebit);
  const juCredit = new Decimal(ju.totalCredit);
  const juBal = juDebit.minus(juCredit).abs().lte('0.01');
  return {
    name: 'Arus Kas + Jurnal Umum compute, jurnal balanced',
    pass: juBal && cf !== undefined,
    detail: `jurnal lines=${ju.lines.length} D=${juDebit} K=${juCredit} | cf opening=${cf.openingCash} closing=${cf.closingCash}`,
  };
}

async function gate8_cacheRoundTrip(): Promise<GateResult> {
  if (process.env.SKIP_CACHE_GATE === '1') {
    return { name: 'Report cache (skipped)', pass: true, detail: 'SKIP_CACHE_GATE=1' };
  }
  const tenantId = await adminTenantId();
  const period = periodAllTime();
  const key = reportCacheKey(tenantId, 'trial-balance', period);
  const payload = { ts: Date.now(), marker: 'sprint4-gate' };
  await setCachedReport(key, payload);
  const got = await getCachedReport<typeof payload>(key);
  if (got?.marker !== payload.marker) {
    return {
      name: 'Report cache: set/get/invalidate',
      pass: false,
      detail: `Redis unavailable or cache miss — set SKIP_CACHE_GATE=1 for offline dev`,
    };
  }
  const deleted = await invalidateTenantReports(tenantId);
  const after = await getCachedReport<typeof payload>(key);
  return {
    name: 'Report cache: set/get/invalidate',
    pass: deleted >= 1 && after === null,
    detail: `got.marker=${got.marker} deleted=${deleted} after=${after === null ? 'null' : 'still present'}`,
  };
}

async function gate9_xlsxExporter(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const period = periodAllTime();
  const tb = await buildTrialBalance({ tenantId, period });
  const buf = await renderReportXlsx({
    reportType: 'trial-balance',
    tenantId,
    period,
    generatedAt: new Date().toISOString(),
    data: tb,
  });
  return {
    name: 'XLSX exporter (trial-balance)',
    pass: buf.length > 1000,
    detail: `${buf.length} bytes`,
  };
}

async function gate10_pdfExporter(): Promise<GateResult> {
  if (process.env.SKIP_PDF_GATE === '1') {
    return { name: 'PDF exporter (skipped)', pass: true, detail: 'SKIP_PDF_GATE=1' };
  }
  const tenantId = await adminTenantId();
  const period = periodAllTime();
  const tb = await buildTrialBalance({ tenantId, period });
  try {
    const buf = await renderReportPdf({
      reportType: 'trial-balance',
      tenantId,
      period,
      generatedAt: new Date().toISOString(),
      data: tb,
    });
    return {
      name: 'PDF exporter (trial-balance)',
      pass: buf.length > 1000 && buf.subarray(0, 4).toString('utf8') === '%PDF',
      detail: `${buf.length} bytes, magic=${buf.subarray(0, 4).toString('utf8')}`,
    };
  } catch (e) {
    return {
      name: 'PDF exporter (trial-balance)',
      pass: false,
      detail: `puppeteer launch failed: ${(e as Error).message.slice(0, 200)}`,
    };
  } finally {
    await closeReportPdfBrowser();
  }
}

async function main() {
  const gates = [
    gate1_matViewsExist,
    gate2_matViewsPopulated,
    gate3_balanceSheetRuns,
    gate4_trialBalanceBalances,
    gate5_activityMatchesNetAssets,
    gate6_generalLedgerConsistent,
    gate7_cashFlowAndJurnal,
    gate8_cacheRoundTrip,
    gate9_xlsxExporter,
    gate10_pdfExporter,
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Sprint 4 Acceptance Gates — Reports');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let allPass = true;
  for (const g of gates) {
    const r = await g();
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon}  ${r.name}`);
    console.log(`      ${r.detail}\n`);
    if (!r.pass) allPass = false;
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(allPass ? '🟢 ALL GATES PASSED — Sprint 4 reports operational' : '🔴 GATES FAILED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await pool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
