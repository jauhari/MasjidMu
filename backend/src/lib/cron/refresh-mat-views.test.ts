import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks (accessible inside vi.mock factories) ────────────────────
const { mockExecute, mockScan, mockDel, mockSchedule, mockStop } = vi.hoisted(() => ({
  mockExecute: vi.fn().mockResolvedValue(undefined),
  mockScan: vi.fn().mockResolvedValue(['0', []]),
  mockDel: vi.fn().mockResolvedValue(0),
  mockSchedule: vi.fn(),
  mockStop: vi.fn(),
}));

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test:test@localhost/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY: 'test', R2_SECRET_KEY: 'test',
    R2_BUCKET: 'test', RESEND_API_KEY: 're_test', ENABLE_CRON: false,
  },
}));

vi.mock('../../db/client.js', () => ({
  asSuperAdmin: vi.fn().mockImplementation(async (fn: Function) => {
    return fn({ execute: mockExecute });
  }),
}));

vi.mock('../redis.js', () => ({
  redis: { scan: mockScan, del: mockDel },
}));

vi.mock('../memory-cache.js', () => {
  const store = new Map<string, unknown>();
  return {
    memClearPrefix: (prefix: string) => {
      let n = 0;
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) { store.delete(key); n++; }
      }
      return n;
    },
    _store: store,
  };
});

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('node-cron', () => ({
  default: { schedule: mockSchedule },
}));

// ─── Imports ────────────────────────────────────────────────────────────────
import {
  _refreshMatViewsOnce as refreshOnce,
  refreshReportsAfterPosting,
  startMatViewRefreshCron,
  stopMatViewRefreshCron,
} from './refresh-mat-views.js';
import { asSuperAdmin } from '../../db/client.js';

// Helper: extract the SQL string from a drizzle sql`` template passed to execute
function getSqlString(callIndex: number): string {
  const arg = mockExecute.mock.calls[callIndex]?.[0];
  if (arg?.queryChunks?.[0]?.value?.[0]) return String(arg.queryChunks[0].value[0]);
  return String(arg);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('refreshOnce', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { _store } = await import('../memory-cache.js');
    _store.clear();
    mockScan.mockResolvedValue(['0', []]);
    mockDel.mockResolvedValue(0);
  });

  it('refreshes both materialized views CONCURRENTLY', async () => {
    const result = await refreshOnce();

    expect(asSuperAdmin).toHaveBeenCalledOnce();
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(getSqlString(0)).toContain('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_account_balances');
    expect(getSqlString(1)).toContain('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_summary');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.cacheKeysDeleted).toBeTypeOf('number');
  });

  it('falls back to non-concurrent refresh when CONCURRENTLY fails', async () => {
    // First CONCURRENTLY call throws → entire try block skipped → catch runs both non-concurrent
    mockExecute.mockRejectedValueOnce(new Error('concurrent refresh not supported'));

    await refreshOnce();

    // 3 calls total: 1 CONCURRENTLY (fails) + 2 non-concurrent (fallback)
    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(getSqlString(1)).toContain('REFRESH MATERIALIZED VIEW mv_account_balances');
    expect(getSqlString(2)).toContain('REFRESH MATERIALIZED VIEW mv_monthly_summary');
    // Confirm non-concurrent versions do NOT contain CONCURRENTLY
    expect(getSqlString(1)).not.toContain('CONCURRENTLY');
    expect(getSqlString(2)).not.toContain('CONCURRENTLY');
  });

  it('clears memory cache keys with report: prefix', async () => {
    const { _store } = await import('../memory-cache.js');
    _store.set('report:1:trial-balance', { data: 'stale' });
    _store.set('report:2:aktivitas', { data: 'stale' });
    _store.set('other:key', { data: 'keep' });

    const result = await refreshOnce();

    expect(result.cacheKeysDeleted).toBeGreaterThanOrEqual(2);
    expect(_store.has('report:1:trial-balance')).toBe(false);
    expect(_store.has('report:2:aktivitas')).toBe(false);
    expect(_store.has('other:key')).toBe(true);
  });

  it('invalidates Redis cache keys via SCAN + DEL', async () => {
    mockScan
      .mockResolvedValueOnce(['42', ['report:1', 'report:2']])
      .mockResolvedValueOnce(['0', ['report:3']]);

    const result = await refreshOnce();

    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(mockScan).toHaveBeenCalledWith('0', { match: 'report:*', count: 200 });
    expect(mockScan).toHaveBeenCalledWith('42', { match: 'report:*', count: 200 });
    expect(mockDel).toHaveBeenCalledTimes(2);
    expect(mockDel).toHaveBeenCalledWith('report:1', 'report:2');
    expect(mockDel).toHaveBeenCalledWith('report:3');
    expect(result.cacheKeysDeleted).toBe(3);
  });

  it('sums memory + Redis deleted counts', async () => {
    const { _store } = await import('../memory-cache.js');
    _store.set('report:mem', { data: 'x' });
    mockScan.mockResolvedValueOnce(['0', ['report:red1', 'report:red2']]);

    const result = await refreshOnce();
    expect(result.cacheKeysDeleted).toBe(3);
  });

  it('gracefully handles Redis errors (Redis optional in dev)', async () => {
    mockScan.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await refreshOnce();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.cacheKeysDeleted).toBe(0);
  });

  it('handles empty Redis scan results', async () => {
    mockScan.mockResolvedValue(['0', []]);

    const result = await refreshOnce();
    expect(mockDel).not.toHaveBeenCalled();
    expect(result.cacheKeysDeleted).toBe(0);
  });
});

describe('refreshReportsAfterPosting', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { _store } = await import('../memory-cache.js');
    _store.clear();
    mockScan.mockResolvedValue(['0', []]);
  });

  it('calls refreshOnce and logs info on success', async () => {
    const { logger } = await import('../logger.js');

    await refreshReportsAfterPosting();

    expect(asSuperAdmin).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: expect.any(Number), cacheKeysDeleted: expect.any(Number) }),
      'mat-view refresh after posting',
    );
  });

  it('swallows errors and logs error (does not throw)', async () => {
    const { logger } = await import('../logger.js');
    vi.mocked(asSuperAdmin).mockRejectedValueOnce(new Error('db down'));

    await expect(refreshReportsAfterPosting()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'mat-view refresh after posting failed',
    );
  });
});

describe('startMatViewRefreshCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopMatViewRefreshCron();
    mockScan.mockResolvedValue(['0', []]);
  });

  afterEach(() => {
    stopMatViewRefreshCron();
  });

  it('starts a cron schedule and logs', async () => {
    const { logger } = await import('../logger.js');
    mockSchedule.mockReturnValue({ stop: mockStop });

    startMatViewRefreshCron();

    expect(mockSchedule).toHaveBeenCalledWith('*/17 * * * *', expect.any(Function));
    expect(logger.info).toHaveBeenCalledWith(
      { schedule: '*/17 * * * *' },
      'mat-view refresh cron started',
    );
  });

  it('is idempotent — does not create duplicate tasks', () => {
    mockSchedule.mockReturnValue({ stop: mockStop });

    startMatViewRefreshCron();
    startMatViewRefreshCron();
    startMatViewRefreshCron();

    expect(mockSchedule).toHaveBeenCalledOnce();
  });

  it('invokes refreshOnce when the cron fires', async () => {
    let cronFn: Function | undefined;
    mockSchedule.mockImplementation((_schedule: string, fn: Function) => {
      cronFn = fn;
      return { stop: mockStop };
    });

    startMatViewRefreshCron();
    expect(cronFn).toBeDefined();

    await cronFn!();

    expect(asSuperAdmin).toHaveBeenCalledOnce();
  });

  it('logs error when cron callback throws', async () => {
    const { logger } = await import('../logger.js');
    let cronFn: Function | undefined;
    mockSchedule.mockImplementation((_schedule: string, fn: Function) => {
      cronFn = fn;
      return { stop: mockStop };
    });
    vi.mocked(asSuperAdmin).mockRejectedValueOnce(new Error('db timeout'));

    startMatViewRefreshCron();
    await cronFn!();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'mat-view refresh failed',
    );
  });
});

describe('stopMatViewRefreshCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopMatViewRefreshCron();
  });

  it('stops the running cron task', () => {
    mockSchedule.mockReturnValue({ stop: mockStop });

    startMatViewRefreshCron();
    stopMatViewRefreshCron();

    expect(mockStop).toHaveBeenCalledOnce();
  });

  it('is safe to call when no cron is running', () => {
    expect(() => stopMatViewRefreshCron()).not.toThrow();
  });

  it('allows restarting after stop', () => {
    mockSchedule.mockReturnValue({ stop: mockStop });

    startMatViewRefreshCron();
    stopMatViewRefreshCron();
    startMatViewRefreshCron();

    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });
});
