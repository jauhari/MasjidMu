import { describe, expect, it } from 'vitest';

describe('healthz', () => {
  it('app boots and serves /healthz', async () => {
    // Set required env BEFORE importing app
    process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/test';
    process.env.BETTER_AUTH_SECRET = 'test-secret-must-be-at-least-32-bytes-aaaa';
    process.env.BETTER_AUTH_URL = 'http://localhost:3000';
    process.env.UPSTASH_REDIS_URL = 'https://placeholder.upstash.io';
    process.env.UPSTASH_REDIS_TOKEN = 'placeholder';
    process.env.R2_ACCOUNT_ID = 'test';
    process.env.R2_ACCESS_KEY = 'test';
    process.env.R2_SECRET_KEY = 'test';
    process.env.R2_BUCKET = 'test';
    process.env.RESEND_API_KEY = 're_test';
    process.env.NODE_ENV = 'test';

    const { app } = await import('./app.js');
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});
