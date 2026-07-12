/**
 * Rate limiter middleware — in-process sliding window (no external store).
 *
 * Was Upstash-backed; moved in-memory because the per-request Redis round
 * trip added a hard external dependency (and fail-closed on any Upstash
 * hiccup) for a single-instance deployment that didn't need it. Revisit if
 * this ever scales to multiple instances needing a shared limit.
 *
 * Three preset limiters:
 *   • login:  5 / 15min  per IP        — guards /api/auth/sign-in/*
 *   • api:    100 / min  per tenant    — guards /api/* generally
 *   • export: 10 / hour  per user      — guards expensive PDF/XLSX endpoints
 *
 * Key derivation:
 *   • login   → IP (X-Forwarded-For chain → first → fallback to remote)
 *   • api     → tenantId if present, else IP
 *   • export  → userId if present, else IP
 *
 * On limit: returns 429 with `retry-after` header (seconds).
 */
import type { MiddlewareHandler } from 'hono';
import { env } from '../lib/env.js';
import { memGet, memSet } from '../lib/memory-cache.js';
import type { SessionVars } from './session.js';
import type { TenantVars } from './tenant.js';

// Looser limits in development so smoke-testing doesn't get throttled.
const isDev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

const LIMITS = {
  login: { count: isDev ? 100 : 5, windowMs: 15 * 60_000 },
  api: { count: isDev ? 1000 : 100, windowMs: 60_000 },
  export: { count: isDev ? 100 : 10, windowMs: 60 * 60_000 },
} as const;

type LimiterKind = keyof typeof LIMITS;

interface LimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

/** Sliding window over an in-memory timestamp list — same shape as Upstash's. */
function slidingWindowLimit(key: string, count: number, windowMs: number): LimitResult {
  const now = Date.now();
  const hits = (memGet<number[]>(key) ?? []).filter((t) => t > now - windowMs);

  if (hits.length >= count) {
    return { success: false, limit: count, remaining: 0, reset: hits[0]! + windowMs };
  }

  hits.push(now);
  memSet(key, hits, Math.ceil(windowMs / 1000));
  return { success: true, limit: count, remaining: count - hits.length, reset: now + windowMs };
}

function clientIp(c: Parameters<MiddlewareHandler>[0]): string {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? 'unknown';
}

export const rateLimit = (
  kind: LimiterKind,
): MiddlewareHandler<{ Variables: SessionVars & TenantVars }> =>
  async (c, next) => {
    let key: string;
    switch (kind) {
      case 'login':
        key = `ip:${clientIp(c)}`;
        break;
      case 'api':
        key = c.get('tenantId') ? `t:${c.get('tenantId')}` : `ip:${clientIp(c)}`;
        break;
      case 'export':
        key = c.get('user')?.id ? `u:${c.get('user')!.id}` : `ip:${clientIp(c)}`;
        break;
    }

    const { count, windowMs } = LIMITS[kind];
    const { success, limit, remaining, reset } = slidingWindowLimit(`rl:${kind}:${key}`, count, windowMs);

    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(reset));

    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'rate_limited', retryAfter }, 429);
    }

    return next();
  };
