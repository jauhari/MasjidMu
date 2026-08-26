import { Hono } from 'hono';
import { tenantResolver, requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { rateLimit } from '../../../middleware/rate-limit.js';
import { InvalidPeriodError, parsePeriod } from '../reports/period.js';
import type { ReportPeriod } from '../reports/types.js';
import { buildPublicFinanceReport, PublicFinanceUnavailableError } from './service.js';
import { renderPublicFinanceImage } from './export-image.js';

function defaultPeriodQuery() {
  const now = new Date();
  return { month: String(now.getUTCMonth() + 1), year: String(now.getUTCFullYear()) };
}

/** No meaningful "start of records" date is tracked -- 2000-01-01 predates
 * every tenant, matching the floor `parsePeriod` already enforces for
 * month/year input. */
function allTimePeriod(): ReportPeriod {
  const now = new Date();
  const endUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  return {
    startDate: new Date(Date.UTC(2000, 0, 1)),
    endDate: endUtc,
    label: 'Seluruh Waktu',
    periodMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { 'Cache-Control': 'no-store', ...extra };
}

export const publicFinanceRoute = new Hono<{ Variables: TenantVars }>()
  .use('*', tenantResolver())
  .use('*', requireTenant())
  .get('/', async (c, next) => {
    return rateLimit(c.req.query('format') === 'image' ? 'publicPdf' : 'public')(c, next);
  }, async (c) => {
    const format = c.req.query('format') ?? 'json';
    if (format !== 'json' && format !== 'image') {
      return c.json({ error: 'invalid_format' }, 400, noStoreHeaders());
    }

    const isAllTime = c.req.query('period') === 'all';
    let period: ReportPeriod;
    if (isAllTime) {
      period = allTimePeriod();
    } else {
      try {
        period = parsePeriod({
          month: c.req.query('month') ?? defaultPeriodQuery().month,
          year: c.req.query('year') ?? defaultPeriodQuery().year,
          startDate: c.req.query('startDate'),
          endDate: c.req.query('endDate'),
        });
      } catch (err) {
        if (err instanceof InvalidPeriodError) {
          return c.json({ error: 'invalid_period', detail: err.message }, 400, noStoreHeaders());
        }
        throw err;
      }
    }

    try {
      const report = await buildPublicFinanceReport({ tenantId: c.get('tenantId')!, period });
      if (format === 'image') {
        const tenantSlug = c.req.query('tenant_slug') ?? '';
        const publicUrl = `https://mizanmu.pages.dev/transparansi/${tenantSlug}`;
        const png = await renderPublicFinanceImage(report, publicUrl, isAllTime);
        return c.body(png as never, {
          headers: noStoreHeaders({
            'Content-Type': 'image/png',
            'Content-Disposition': `inline; filename="keuangan-${period.label}.png"`,
          }),
        });
      }
      return c.json(report, 200, noStoreHeaders());
    } catch (err) {
      if (err instanceof PublicFinanceUnavailableError) {
        return c.json({ error: 'public_report_unavailable' }, 404, noStoreHeaders());
      }
      throw err;
    }
  });
