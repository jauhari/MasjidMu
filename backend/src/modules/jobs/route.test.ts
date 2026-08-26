import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock env before anything imports it (env.js calls process.exit on bad parse)
vi.mock('../../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    JOBS_INTERNAL_TOKEN: 'test-secret-token-abc123',
  },
}));

// Mock the refresh function so tests don't hit the database
vi.mock('../../lib/cron/refresh-mat-views.js', () => ({
  _refreshMatViewsOnce: vi.fn().mockResolvedValue({
    durationMs: 42,
    cacheKeysDeleted: 3,
  }),
}));

// Suppress logger output in tests
vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe as _d, expect as _e, it as _i } from 'vitest';
import { jobsRoute } from './route.js';
import { _refreshMatViewsOnce } from '../../lib/cron/refresh-mat-views.js';

const REFRESH_URL = '/refresh-mv';
const VALID_TOKEN = 'test-secret-token-abc123';

async function req(path: string, init?: RequestInit) {
  return jobsRoute.request(path, init);
}

describe('jobs route — token auth', () => {
  beforeEach(() => {
    vi.mocked(_refreshMatViewsOnce).mockClear();
    vi.mocked(_refreshMatViewsOnce).mockResolvedValue({
      durationMs: 42,
      cacheKeysDeleted: 3,
    });
  });

  it('rejects when Authorization header is missing', async () => {
    const res = await req(REFRESH_URL);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects when Bearer token is wrong', async () => {
    const res = await req(REFRESH_URL, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects when Authorization scheme is not Bearer', async () => {
    const res = await req(REFRESH_URL, {
      headers: { Authorization: `Basic ${VALID_TOKEN}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('allows request with valid Bearer token', async () => {
    const res = await req(REFRESH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(_refreshMatViewsOnce).toHaveBeenCalledOnce();
  });

  it('returns 503 when JOBS_INTERNAL_TOKEN is not set', async () => {
    // Dynamically swap the env mock to simulate missing token
    const envMod = await import('../../lib/env.js');
    const original = envMod.env.JOBS_INTERNAL_TOKEN as string | undefined;
    (envMod.env as { JOBS_INTERNAL_TOKEN: string | undefined }).JOBS_INTERNAL_TOKEN = undefined;

    try {
      const res = await req(REFRESH_URL, {
        headers: { Authorization: 'Bearer anything' },
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'jobs_not_configured' });
    } finally {
      (envMod.env as { JOBS_INTERNAL_TOKEN: string | undefined }).JOBS_INTERNAL_TOKEN = original;
    }
  });
});

describe('jobs route — POST /refresh-mv', () => {
  beforeEach(() => {
    vi.mocked(_refreshMatViewsOnce).mockClear();
    vi.mocked(_refreshMatViewsOnce).mockResolvedValue({
      durationMs: 42,
      cacheKeysDeleted: 3,
    });
  });

  it('returns ok with refresh stats on success', async () => {
    const res = await req(REFRESH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.durationMs).toBe(42);
    expect(body.cacheKeysDeleted).toBe(3);
  });

  it('calls _refreshMatViewsOnce exactly once', async () => {
    await req(REFRESH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(_refreshMatViewsOnce).toHaveBeenCalledOnce();
  });

  it('returns 500 when refresh function throws', async () => {
    vi.mocked(_refreshMatViewsOnce).mockRejectedValueOnce(
      new Error('database connection refused'),
    );

    const res = await req(REFRESH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'refresh_failed' });
  });

  it('GET /refresh-mv returns 404 (only POST allowed)', async () => {
    const res = await req(REFRESH_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    // Hono returns 404 for unmatched method on a registered route
    expect(res.status).toBe(404);
  });
});
