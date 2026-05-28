/**
 * Rate limiter middleware (Upstash sliding window).
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
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { MiddlewareHandler } from 'hono';
import { env } from '../lib/env.js';
import type { SessionVars } from './session.js';
import type { TenantVars } from './tenant.js';

const redis = new Redis({
  url: env.UPSTASH_REDIS_URL,
  token: env.UPSTASH_REDIS_TOKEN,
});

// Looser limits in development so smoke-testing doesn't get throttled.
const isDev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

const limiters = {
  login: new Ratelimit({
    redis,
    limiter: isDev
      ? Ratelimit.slidingWindow(100, '15 m')
      : Ratelimit.slidingWindow(5, '15 m'),
    analytics: false,
    prefix: 'rl:login',
  }),
  api: new Ratelimit({
    redis,
    limiter: isDev
      ? Ratelimit.slidingWindow(1000, '1 m')
      : Ratelimit.slidingWindow(100, '1 m'),
    analytics: false,
    prefix: 'rl:api',
  }),
  export: new Ratelimit({
    redis,
    limiter: isDev
      ? Ratelimit.slidingWindow(100, '1 h')
      : Ratelimit.slidingWindow(10, '1 h'),
    analytics: false,
    prefix: 'rl:export',
  }),
} as const;

type LimiterKind = keyof typeof limiters;

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

    const { success, limit, remaining, reset } = await limiters[kind].limit(key);

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
