import { Hono } from 'hono';
import { tenantResolver, requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { rateLimit } from '../../../middleware/rate-limit.js';
import { InvalidPeriodError, parsePeriod } from '../reports/period.js';
import { buildPublicPapReport, PublicPapUnavailableError } from './service.js';
import { renderPublicPapPdf } from './export.js';

function defaultPeriodQuery() {
  const now = new Date();
  return { month: String(now.getUTCMonth() + 1), year: String(now.getUTCFullYear()) };
}

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { 'Cache-Control': 'no-store', ...extra };
}

export const publicPapRoute = new Hono<{ Variables: TenantVars }>()
  .use('*', tenantResolver())
  .use('*', requireTenant())
  .get('/', async (c, next) => {
    return rateLimit(c.req.query('format') === 'pdf' ? 'publicPdf' : 'public')(c, next);
  }, async (c) => {
    const format = c.req.query('format') ?? 'json';
    if (format !== 'json' && format !== 'pdf') {
      return c.json({ error: 'invalid_format' }, 400, noStoreHeaders());
    }

    let period;
    try {
      period = parsePeriod({
        ...defaultPeriodQuery(),
        month: c.req.query('month'),
        year: c.req.query('year'),
        startDate: c.req.query('startDate'),
        endDate: c.req.query('endDate'),
      });
    } catch (err) {
      if (err instanceof InvalidPeriodError) {
        return c.json({ error: 'invalid_period', detail: err.message }, 400, noStoreHeaders());
      }
      throw err;
    }

    try {
      const report = await buildPublicPapReport({ tenantId: c.get('tenantId')!, period });
      if (format === 'pdf') {
        const pdf = await renderPublicPapPdf(report);
        return c.body(pdf as never, {
          headers: noStoreHeaders({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="laporan-dana-pap-${period.label}.pdf"`,
          }),
        });
      }
      return c.json(report, 200, noStoreHeaders());
    } catch (err) {
      if (err instanceof PublicPapUnavailableError) {
        return c.json({ error: 'public_report_unavailable' }, 404, noStoreHeaders());
      }
      throw err;
    }
  });
