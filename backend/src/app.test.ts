import { describe, expect, it } from 'vitest';
import './lib/env.js';

describe('healthz', () => {
  it('app boots and serves /healthz', async () => {
    const { app } = await import('./app.js');
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');

    const apiRes = await app.request('/api/healthz');
    expect(apiRes.status).toBe(200);
    const apiBody = (await apiRes.json()) as { status: string };
    expect(apiBody.status).toBe('ok');
  }, 15_000);
});
