import * as Sentry from '@sentry/node';
import { env } from './env.js';

let initialized = false;

export function initSentry(): typeof Sentry {
  if (initialized) return Sentry;
  if (!env.SENTRY_DSN) {
    return Sentry; // no-op
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
    // Don't send PII by default; tag with tenantId at capture time instead.
    sendDefaultPii: false,
  });

  initialized = true;
  return Sentry;
}

export { Sentry };
