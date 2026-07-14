/**
 * Reports route — `/api/v1/reports/*`.
 *
 *   GET /api/v1/reports/posisi-keuangan?month=&year=
 *   GET /api/v1/reports/aktivitas?month=&year=
 *   GET /api/v1/reports/perubahan-aset-neto?month=&year=
 *   GET /api/v1/reports/arus-kas?month=&year=
 *   GET /api/v1/reports/general-ledger?month=&year=&accountCode=
 *   GET /api/v1/reports/trial-balance?month=&year=
 *   GET /api/v1/reports/jurnal-umum?month=&year=
 *
 * All endpoints accept either:
 *   - month=1..12 + year=YYYY  (calendar month)
 *   - startDate=YYYY-MM-DD + endDate=YYYY-MM-DD  (custom)
 *   - compareMonth/compareYear or compareStartDate/compareEndDate (optional)
 *
 * Output formats via `format=`:
 *   - json (default) — cached in Redis for 5 min
 *   - pdf  — rendered via puppeteer
 *   - xlsx — rendered via exceljs
 *
 * Permission: `reports.read` for json; `reports.export` for pdf/xlsx.
 */
import { Hono } from 'hono';
import { auditInterceptor } from '../../../lib/audit.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import {
  requirePermission,
  type PermissionVars,
} from '../../../middleware/permission.js';
import {
  getCachedReport,
  reportCacheKey,
  setCachedReport,
} from './cache.js';
import { InvalidPeriodError, parseComparePeriod, parsePeriod } from './period.js';
import type {
  ConsolidatedFundUsageData,
  ExportFormat,
  ReportResponse,
  ReportType,
} from './types.js';
import { buildBalanceSheet } from './services/balance-sheet.js';
import { buildActivity } from './services/activity.js';
import { buildNetAssetsChange } from './services/net-assets-change.js';
import { buildCashFlow } from './services/cash-flow.js';
import { buildGeneralLedger } from './services/general-ledger.js';
import { buildTrialBalance } from './services/trial-balance.js';
import { buildJurnalUmum } from './services/jurnal-umum.js';
import { buildFundUsage } from './services/fund-usage.js';
import { buildFundLedger, FundLedgerNotFoundError } from './services/fund-ledger.js';
import { buildConsolidatedFundUsage } from './services/consolidation.js';
import { renderReportPdf } from './export/pdf.js';
import { renderReportXlsx } from './export/xlsx.js';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  getPublicPapStatus,
  publishPublicPap,
  revokePublicPap,
} from '../public-pap/service.js';

function resolveFormat(raw: string | undefined): ExportFormat {
  if (raw === 'pdf' || raw === 'xlsx') return raw;
  return 'json';
}

function parseQuery(c: { req: { query: (key: string) => string | undefined } }) {
  return {
    month: c.req.query('month'),
    year: c.req.query('year'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
    compareMonth: c.req.query('compareMonth'),
    compareYear: c.req.query('compareYear'),
    compareStartDate: c.req.query('compareStartDate'),
    compareEndDate: c.req.query('compareEndDate'),
    format: resolveFormat(c.req.query('format')),
    accountCode: c.req.query('accountCode'),
  };
}

interface BuildArgs<T> {
  reportType: ReportType;
  build: (req: {
    tenantId: string;
    period: ReturnType<typeof parsePeriod>;
    comparePeriod?: ReturnType<typeof parsePeriod>;
  }) => Promise<T>;
}

async function handle<T>(
  c: {
    get: (k: string) => unknown;
    req: { query: (k: string) => string | undefined };
    json: (b: unknown, s?: number) => Response;
    body: (b: BodyInit | null, init?: ResponseInit) => Response;
  },
  args: BuildArgs<T>,
): Promise<Response> {
  const tenantId = c.get('tenantId') as string;
  const q = parseQuery(c);
  let period: ReturnType<typeof parsePeriod>;
  let comparePeriod: ReturnType<typeof parsePeriod> | undefined;
  try {
    period = parsePeriod(q);
    comparePeriod = parseComparePeriod(q);
  } catch (e) {
    if (e instanceof InvalidPeriodError) {
      return c.json({ error: 'invalid_period', detail: e.message }, 400);
    }
    throw e;
  }

  const cacheKey = reportCacheKey(tenantId, args.reportType, period, comparePeriod);

  // ─── JSON path ─────────────────────────────────────────────────────────
  if (q.format === 'json') {
    const cached = await getCachedReport<ReportResponse<T>>(cacheKey);
    if (cached) {
      return c.json(cached);
    }
    const data = await args.build({ tenantId, period, comparePeriod });
    const response: ReportResponse<T> = {
      reportType: args.reportType,
      tenantId,
      period,
      comparePeriod,
      generatedAt: new Date().toISOString(),
      data,
    };
    await setCachedReport(cacheKey, response);
    return c.json(response);
  }

  // ─── PDF / XLSX paths (no caching of binary) ──────────────────────────
  const data = await args.build({ tenantId, period, comparePeriod });
  const response: ReportResponse<T> = {
    reportType: args.reportType,
    tenantId,
    period,
    comparePeriod,
    generatedAt: new Date().toISOString(),
    data,
  };
  if (q.format === 'pdf') {
    const pdf = await renderReportPdf(response);
    return c.body(pdf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${args.reportType}-${period.label}.pdf"`,
      },
    });
  }
  if (q.format === 'xlsx') {
    const xlsx = await renderReportXlsx(response);
    return c.body(xlsx as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${args.reportType}-${period.label}.xlsx"`,
      },
    });
  }
  return c.json({ error: 'unsupported_format' }, 400);
}

function permFor(format: ExportFormat): string {
  return format === 'json' ? 'reports.read' : 'reports.export';
}

const publishPublicPapSchema = z.object({
  fundId: z.string().uuid(),
});

export const reportsRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/public-pap', requirePermission('reports.read'), async (c) => {
    const status = await getPublicPapStatus(c.get('tenantId')!);
    return c.json({ data: status });
  })

  .post(
    '/public-pap/publish',
    requirePermission('reports.publish'),
    zValidator('json', publishPublicPapSchema),
    async (c) => {
      const row = await publishPublicPap({
        tenantId: c.get('tenantId')!,
        fundId: c.req.valid('json').fundId,
        actorAuthUserId: c.get('user')!.id,
      });
      if (!row) return c.json({ error: 'fund_not_publishable' }, 400);
      return c.json({ data: row });
    },
  )

  .post('/public-pap/revoke', requirePermission('reports.publish'), async (c) => {
    const row = await revokePublicPap({
      tenantId: c.get('tenantId')!,
      actorAuthUserId: c.get('user')!.id,
    });
    return c.json({ data: row });
  })

  // For each route we evaluate the permission against the requested format.
  // The handler computes `format` again, so we just gate at the broader level
  // (`reports.read`) and re-check `reports.export` inline if needed.

  .get('/posisi-keuangan', async (c, next) => {
    const fmt = resolveFormat(c.req.query('format'));
    return requirePermission(permFor(fmt))(c, next);
  }, async (c) =>
    handle(c, { reportType: 'posisi-keuangan', build: (r) => buildBalanceSheet(r) }),
  )

  .get('/aktivitas', async (c, next) => {
    const fmt = resolveFormat(c.req.query('format'));
    return requirePermission(permFor(fmt))(c, next);
  }, async (c) => handle(c, { reportType: 'aktivitas', build: (r) => buildActivity(r) }))

  .get('/perubahan-aset-neto', async (c, next) => {
    const fmt = resolveFormat(c.req.query('format'));
    return requirePermission(permFor(fmt))(c, next);
  }, async (c) =>
    handle(c, { reportType: 'perubahan-aset-neto', build: (r) => buildNetAssetsChange(r) }),
  )

  .get('/arus-kas', async (c, next) => {
    const fmt = resolveFormat(c.req.query('format'));
    return requirePermission(permFor(fmt))(c, next);
  }, async (c) => handle(c, { reportType: 'arus-kas', build: (r) => buildCashFlow(r) }))

  .get('/general-ledger', async (c, next) => {
    const fmt = resolveFormat(c.req.query('format'));
    return requirePermission(permFor(fmt))(c, next);
  }, async (c) => {
    const accountCode = c.req.query('accountCode');
    return handle(c, {
      reportType: 'general-ledger',
      build: (r) => buildGeneralLedger({ ...r, accountCode }),
    });
  })

  .get('/trial-balance', async (c, next) => {
    const fmt = resolveFormat(c.req.query('format'));
    return requirePermission(permFor(fmt))(c, next);
  }, async (c) => handle(c, { reportType: 'trial-balance', build: (r) => buildTrialBalance(r) }))

  .get('/jurnal-umum', async (c, next) => {
    const fmt = resolveFormat(c.req.query('format'));
    return requirePermission(permFor(fmt))(c, next);
  }, async (c) => handle(c, { reportType: 'jurnal-umum', build: (r) => buildJurnalUmum(r) }))

  .get('/sumber-penggunaan-dana', async (c, next) => {
    const fmt = resolveFormat(c.req.query('format'));
    return requirePermission(permFor(fmt))(c, next);
  }, async (c) =>
    handle(c, { reportType: 'sumber-penggunaan-dana', build: (r) => buildFundUsage(r) }),
  )

  // Detail 1 dana (mis. Infaq Rutin PAP) — wajib fundId. Cache key include fundId.
  .get('/buku-dana', async (c, next) => {
    const fmt = resolveFormat(c.req.query('format'));
    return requirePermission(permFor(fmt))(c, next);
  }, async (c) => {
    const fundId = c.req.query('fundId');
    if (!fundId) {
      return c.json({ error: 'fund_id_required', detail: 'Parameter fundId wajib diisi' }, 400);
    }
    const tenantId = c.get('tenantId') as string;
    const q = parseQuery(c);
    let period: ReturnType<typeof parsePeriod>;
    try {
      period = parsePeriod(q);
    } catch (e) {
      if (e instanceof InvalidPeriodError) {
        return c.json({ error: 'invalid_period', detail: e.message }, 400);
      }
      throw e;
    }

    try {
      const cacheKey = `${reportCacheKey(tenantId, 'buku-dana', period)}:fund:${fundId}`;
      if (q.format === 'json') {
        const cached = await getCachedReport(cacheKey);
        if (cached) return c.json(cached);
        const data = await buildFundLedger({ tenantId, period, fundId });
        const response = {
          reportType: 'buku-dana' as const,
          tenantId,
          period,
          generatedAt: new Date().toISOString(),
          data,
        };
        await setCachedReport(cacheKey, response);
        return c.json(response);
      }
      const data = await buildFundLedger({ tenantId, period, fundId });
      const response = {
        reportType: 'buku-dana' as const,
        tenantId,
        period,
        generatedAt: new Date().toISOString(),
        data,
      };
      if (q.format === 'pdf') {
        const pdf = await renderReportPdf(response);
        return c.body(pdf as never, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="buku-dana-${period.label}.pdf"`,
          },
        });
      }
      if (q.format === 'xlsx') {
        const xlsx = await renderReportXlsx(response);
        return c.body(xlsx as never, {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="buku-dana-${period.label}.xlsx"`,
          },
        });
      }
      return c.json({ error: 'unsupported_format' }, 400);
    } catch (e) {
      if (e instanceof FundLedgerNotFoundError) {
        return c.json({ error: 'fund_not_found', detail: e.message }, 404);
      }
      throw e;
    }
  })

  // Konsolidasi multi-entitas: tenant dari sesi diperlakukan sebagai induk;
  // service meresolusi cabangnya sendiri. Mendukung json/pdf/xlsx.
  .get('/konsolidasi/sumber-penggunaan-dana', async (c, next) => {
    const fmt = resolveFormat(c.req.query('format'));
    return requirePermission(permFor(fmt))(c, next);
  }, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const q = parseQuery(c);
    let period: ReturnType<typeof parsePeriod>;
    try {
      period = parsePeriod(q);
    } catch (e) {
      if (e instanceof InvalidPeriodError) {
        return c.json({ error: 'invalid_period', detail: e.message }, 400);
      }
      throw e;
    }
    const data = await buildConsolidatedFundUsage({ parentTenantId: tenantId, period });
    const response: ReportResponse<ConsolidatedFundUsageData> = {
      reportType: 'konsolidasi-dana',
      tenantId,
      period,
      generatedAt: new Date().toISOString(),
      data,
    };
    if (q.format === 'pdf') {
      const pdf = await renderReportPdf(response);
      return c.body(pdf as unknown as ArrayBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="konsolidasi-dana-${period.label}.pdf"`,
        },
      });
    }
    if (q.format === 'xlsx') {
      const xlsx = await renderReportXlsx(response);
      return c.body(xlsx as unknown as ArrayBuffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="konsolidasi-dana-${period.label}.xlsx"`,
        },
      });
    }
    return c.json(response);
  });
