/**
 * Report cache — memoizes JSON report bodies in-process for 5 minutes.
 *
 * In-memory (not Redis) — a per-instance cache is enough at single-instance
 * scale and removes a hard external dependency. Revisit if this ever runs as
 * multiple instances needing a shared cache.
 *
 * Keys: `report:{tenantId}:{reportType}:{periodKey}[:cmp:{compareKey}]`
 * Values: JSON-serialized response body.
 *
 * On cache miss the caller computes fresh data and stores it. Materialized
 * view refresh cron also clears the entire `report:{tenantId}:*` namespace
 * to avoid serving balances older than the latest mat view snapshot.
 */
import { memClearPrefix, memGet, memSet } from '../../../lib/memory-cache.js';
import type { ReportPeriod, ReportType } from './types.js';

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
  return memGet<T>(key);
}

export async function setCachedReport<T>(key: string, value: T): Promise<void> {
  memSet(key, value, TTL_SECONDS);
}

/**
 * Invalidate every report cache entry for a tenant.
 * Called by the mat-view refresh cron and by accounts/transactions mutations.
 */
export async function invalidateTenantReports(tenantId: string): Promise<number> {
  return memClearPrefix(`report:${tenantId}:`);
}
