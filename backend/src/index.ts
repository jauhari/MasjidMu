import { serve } from '@hono/node-server';
import { app } from './app.js';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { startMatViewRefreshCron } from './lib/cron/refresh-mat-views.js';

if (env.ENABLE_CRON) {
  startMatViewRefreshCron();
}

/**
 * On Windows, `tsx watch` can leave the previous listener half-alive for a
 * moment during restart → EADDRINUSE. Retry a few times instead of dying
 * permanently (which makes the FE proxy look "sering down").
 */
function listen(attempt = 1): void {
  const maxAttempts = 8;
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    logger.info(`HisabMu API listening on http://localhost:${info.port}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempt < maxAttempts) {
      const delayMs = 300 * attempt;
      logger.warn(
        `Port ${env.PORT} busy (attempt ${attempt}/${maxAttempts}), retry in ${delayMs}ms…`,
      );
      try {
        server.close();
      } catch {
        /* ignore */
      }
      setTimeout(() => listen(attempt + 1), delayMs);
      return;
    }
    logger.error({ err }, `Failed to bind port ${env.PORT}`);
    process.exit(1);
  });
}

listen();
