import { serve } from '@hono/node-server';
import { app } from './app.js';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { startMatViewRefreshCron } from './lib/cron/refresh-mat-views.js';

if (env.ENABLE_CRON) {
  startMatViewRefreshCron();
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`MasjidMu API listening on http://localhost:${info.port}`);
});
