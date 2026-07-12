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
    // CONCURRENTLY butuh unique index (ada di 050). Fallback non-concurrent
    // jika concurrent gagal (mis. view kosong pertama kali / lock).
    try {
      await tx.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_account_balances`);
      await tx.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_summary`);
    } catch {
      await tx.execute(sql`REFRESH MATERIALIZED VIEW mv_account_balances`);
      await tx.execute(sql`REFRESH MATERIALIZED VIEW mv_monthly_summary`);
    }
  });

  // Invalidate every report:* cache key — mat views just changed.
  // Dev pakai memory-cache; production pakai Redis.
  const { memClearPrefix } = await import('../memory-cache.js');
  let deleted = memClearPrefix('report:');

  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, { match: 'report:*', count: 200 });
      cursor = String(next);
      if (keys.length > 0) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== '0');
  } catch {
    // Redis optional di dev
  }

  return { durationMs: Date.now() - start, cacheKeysDeleted: deleted };
}

/**
 * Dipanggil setelah transaksi di-posting agar dashboard/laporan langsung up-to-date
 * (tanpa menunggu cron 17 menit / ENABLE_CRON).
 */
export async function refreshReportsAfterPosting(): Promise<void> {
  try {
    const r = await refreshOnce();
    logger.info({ ...r }, 'mat-view refresh after posting');
  } catch (err) {
    // Jangan gagalkan posting hanya karena refresh MV gagal
    logger.error({ err }, 'mat-view refresh after posting failed');
  }
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
