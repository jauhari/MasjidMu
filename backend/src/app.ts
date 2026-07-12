import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { logger as pinoLogger } from './lib/logger.js';
import { initSentry } from './lib/sentry.js';
import { alertTelegram } from './lib/telegram.js';
import { auth } from './lib/auth.js';
import { sessionResolver, type SessionVars } from './middleware/session.js';
import { tenantResolver, type TenantVars } from './middleware/tenant.js';
import { permissionResolver, type PermissionVars } from './middleware/permission.js';
import { rateLimit } from './middleware/rate-limit.js';
import { tenantsRoute } from './modules/core/tenants/route.js';
import { usersRoute } from './modules/core/users/route.js';
import { accountsRoute } from './modules/accounting/accounts/route.js';
import { transactionCategoriesRoute } from './modules/accounting/transaction-categories/route.js';
import { transactionsRoute } from './modules/accounting/transactions/route.js';
import { fundsRoute } from './modules/accounting/funds/route.js';
import { reportsRoute } from './modules/accounting/reports/route.js';
import { mosqueProfileRoute } from './modules/organization/mosque-profile/route.js';
import { periodsRoute } from './modules/organization/periods/route.js';
import { positionsRoute } from './modules/organization/positions/route.js';
import { officersRoute } from './modules/organization/officers/route.js';
import { announcementsRoute } from './modules/content/announcements/route.js';
import { programsRoute } from './modules/content/programs/route.js';
import { postsRoute } from './modules/content/posts/route.js';
import { eventsRoute } from './modules/content/events/route.js';
import { galleriesRoute } from './modules/content/galleries/route.js';

const Sentry = initSentry();

export const app = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>();

app.use('*', secureHeaders());

app.use('/api/*', cors({
  origin: (origin) => {
    if (!origin) return null;
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
    // Production tenants / admin (canonical)
    if (/^https:\/\/[a-z0-9-]+\.hisabmu\.id$/.test(origin)) return origin;
    if (/^https:\/\/(www\.)?hisabmu\.id$/.test(origin)) return origin;
    // Legacy / alternate domain
    if (/^https:\/\/[a-z0-9-]+\.masjidmu\.id$/.test(origin)) return origin;
    if (/^https:\/\/(www\.)?masjidmu\.id$/.test(origin)) return origin;
    // Cloudflare Pages preview & production *.pages.dev
    if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.pages\.dev$/.test(origin)) return origin;
    return null;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));

app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  pinoLogger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
});

app.onError((err, c) => {
  pinoLogger.error({ err, path: c.req.path }, 'unhandled error');
  Sentry.captureException(err, {
    tags: { path: c.req.path, method: c.req.method },
  });
  // Fire-and-forget: critical alerts go to Telegram for high-severity errors.
  void alertTelegram('error', `Unhandled error on ${c.req.method} ${c.req.path}`, {
    message: err instanceof Error ? err.message : String(err),
  });
  return c.json({ error: 'internal_error' }, 500);
});

app.get('/healthz', (c) =>
  c.json({ status: 'ok', time: new Date().toISOString(), version: '0.0.0' }),
);

app.get('/', (c) => c.text('HisabMu API v2'));

// ─── Auth ────────────────────────────────────────────────────────────────
// Per-IP rate limit on sign-in/sign-up to slow down credential stuffing.
app.use('/api/auth/sign-in/*', rateLimit('login'));
app.use('/api/auth/sign-up/*', rateLimit('login'));
// better-auth handles its own routes under /api/auth/*
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// ─── App API (v1) — full middleware stack ────────────────────────────────
app.use('/api/v1/*', sessionResolver());
app.use('/api/v1/*', tenantResolver());
app.use('/api/v1/*', permissionResolver());
app.use('/api/v1/*', rateLimit('api'));

app.route('/api/v1/tenants', tenantsRoute);
app.route('/api/v1/users', usersRoute);
app.route('/api/v1/accounts', accountsRoute);
app.route('/api/v1/transaction-categories', transactionCategoriesRoute);
app.route('/api/v1/transactions', transactionsRoute);
app.route('/api/v1/funds', fundsRoute);
app.route('/api/v1/reports', reportsRoute);
app.route('/api/v1/mosque-profile', mosqueProfileRoute);
app.route('/api/v1/periods', periodsRoute);
app.route('/api/v1/positions', positionsRoute);
app.route('/api/v1/officers', officersRoute);
app.route('/api/v1/announcements', announcementsRoute);
app.route('/api/v1/programs', programsRoute);
app.route('/api/v1/posts', postsRoute);
app.route('/api/v1/events', eventsRoute);
app.route('/api/v1/galleries', galleriesRoute);

app.get('/api/v1/me', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  const perms = c.get('permissions');
  const tenant = c.get('tenant');
  return c.json({
    data: {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      isSuperAdmin: !!c.get('isSuperAdmin'),
      permissions: perms ? Array.from(perms) : [],
      // Nama cantik lembaga untuk header/dashboard (bukan slug).
      tenant: tenant
        ? {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            edition: tenant.edition,
          }
        : null,
    },
  });
});

// Dev-only: synthetic error to verify Sentry + Telegram pipeline.
if (process.env.NODE_ENV !== 'production') {
  app.get('/_test-error', () => {
    throw new Error('synthetic test error from /_test-error');
  });
}
