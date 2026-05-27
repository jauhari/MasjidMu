import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { logger as pinoLogger } from './lib/logger.js';
import { initSentry } from './lib/sentry.js';
import { alertTelegram } from './lib/telegram.js';

const Sentry = initSentry();

export const app = new Hono();

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

// Dev-only: synthetic error to verify Sentry + Telegram pipeline.
if (process.env.NODE_ENV !== 'production') {
  app.get('/_test-error', () => {
    throw new Error('synthetic test error from /_test-error');
  });
}
