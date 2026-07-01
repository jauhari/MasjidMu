/**
 * Report cache — wraps Redis to memoize JSON report bodies for 5 minutes.
 *
 * Keys: `report:{tenantId}:{reportType}:{periodKey}[:cmp:{compareKey}]`
 * Values: JSON-serialized response body.
 *
 * On cache miss the caller computes fresh data and stores it. Materialized
 * view refresh cron also clears the entire `report:{tenantId}:*` namespace
 * to avoid serving balances older than the latest mat view snapshot.
 */
import { memClearPrefix, memGet, memSet } from '../../../lib/memory-cache.js';
import { redis } from '../../../lib/redis.js';
import { env } from '../../../lib/env.js';
import type { ReportPeriod, ReportType } from './types.js';

const isDev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

const TTL_SECONDS = 5 * 60;

function periodKey(p: ReportPeriod): string {
  // ISO-ish: yyyymmdd-yyyymmdd. Stable + sortable + URL-safe.
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${fmt(p.startDate)}-${fmt(p.endDate)}`;
}

export function reportCacheKey(
  tenantId: string,
  reportType: ReportType,
  period: ReportPeriod,
  comparePeriod?: ReportPeriod,
): string {
  const base = `report:${tenantId}:${reportType}:${periodKey(period)}`;
  return comparePeriod ? `${base}:cmp:${periodKey(comparePeriod)}` : base;
}

export async function getCachedReport<T>(key: string): Promise<T | null> {
  if (isDev) return memGet<T>(key);
  try {
    const raw = await redis.get<T>(key);
    return raw ?? null;
  } catch {
    throw new Error('report_cache_unavailable');
  }
}

export async function setCachedReport<T>(key: string, value: T): Promise<void> {
  if (isDev) {
    memSet(key, value, TTL_SECONDS);
    return;
  }
  try {
    await redis.set(key, value, { ex: TTL_SECONDS });
  } catch {
    throw new Error('report_cache_unavailable');
  }
}

/**
 * Invalidate every report cache entry for a tenant.
 * Called by the mat-view refresh cron and by accounts/transactions mutations.
 */
export async function invalidateTenantReports(tenantId: string): Promise<number> {
  if (isDev) return memClearPrefix(`report:${tenantId}:`);
  try {
    const pattern = `report:${tenantId}:*`;
    // Upstash REST exposes scan via cursor; we batch-delete to keep payload small.
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await redis.scan(cursor, { match: pattern, count: 200 });
      cursor = String(next);
      if (keys.length > 0) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== '0');
    return deleted;
  } catch {
    if (!isDev) throw new Error('report_cache_unavailable');
    return 0;
  }
}
