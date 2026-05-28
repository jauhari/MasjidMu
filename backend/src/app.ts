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

const Sentry = initSentry();

export const app = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>();

app.use('*', secureHeaders());

app.use('/api/*', cors({
  origin: (origin) => {
    if (!origin) return null;
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
    if (/^https:\/\/[a-z0-9-]+\.masjidmu\.id$/.test(origin)) return origin;
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

app.get('/', (c) => c.text('MasjidMu API v2'));

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

// Dev-only: synthetic error to verify Sentry + Telegram pipeline.
if (process.env.NODE_ENV !== 'production') {
  app.get('/_test-error', () => {
    throw new Error('synthetic test error from /_test-error');
  });
}
