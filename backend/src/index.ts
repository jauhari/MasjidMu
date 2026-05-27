import { serve } from '@hono/node-server';
import { app } from './app.js';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`MasjidMu API listening on http://localhost:${info.port}`);
});
