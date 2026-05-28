/**
 * Materialized view refresh cron.
 *
 * Refreshes `mv_account_balances` + `mv_monthly_summary` CONCURRENTLY (no
 * write lock) every 17 minutes, then invalidates every tenant's report cache
 * so subsequent reads pick up fresh balances.
 *
 * Concurrent refresh requires the unique index on (tenant_id, account_id,
 * period_month) — present in 050_report_views.sql.
 *
 * Activated only when ENABLE_CRON=true. The dev server stays cron-free by
 * default to avoid surprise DB load while iterating.
 */
import cron from 'node-cron';
import { sql } from 'drizzle-orm';
import { asSuperAdmin } from '../../db/client.js';
import { redis } from '../redis.js';
import { logger } from '../logger.js';

const SCHEDULE = '*/17 * * * *';

async function refreshOnce(): Promise<{ durationMs: number; cacheKeysDeleted: number }> {
  const start = Date.now();
  await asSuperAdmin(async (tx) => {
    await tx.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_account_balances`);
    await tx.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_summary`);
  });

  // Invalidate every report:* cache key — mat views just changed.
  let cursor = '0';
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, { match: 'report:*', count: 200 });
    cursor = String(next);
    if (keys.length > 0) {
      await redis.del(...keys);
      deleted += keys.length;
    }
  } while (cursor !== '0');

  return { durationMs: Date.now() - start, cacheKeysDeleted: deleted };
}

let task: cron.ScheduledTask | null = null;

export function startMatViewRefreshCron(): void {
  if (task) return;
  task = cron.schedule(SCHEDULE, async () => {
    try {
      const r = await refreshOnce();
      logger.info({ ...r }, 'mat-view refresh complete');
    } catch (err) {
      logger.error({ err }, 'mat-view refresh failed');
    }
  });
  logger.info({ schedule: SCHEDULE }, 'mat-view refresh cron started');
}

export function stopMatViewRefreshCron(): void {
  task?.stop();
  task = null;
}

export { refreshOnce as _refreshMatViewsOnce };
