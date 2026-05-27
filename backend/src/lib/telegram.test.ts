import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const baseEnv = {
  DATABASE_URL: 'postgresql://placeholder:placeholder@localhost:5432/test',
  BETTER_AUTH_SECRET: 'test-secret-must-be-at-least-32-bytes-aaaa',
  BETTER_AUTH_URL: 'http://localhost:3000',
  UPSTASH_REDIS_URL: 'https://placeholder.upstash.io',
  UPSTASH_REDIS_TOKEN: 'placeholder',
  R2_ACCOUNT_ID: 'test',
  R2_ACCESS_KEY: 'test',
  R2_SECRET_KEY: 'test',
  R2_BUCKET: 'test',
  RESEND_API_KEY: 're_test',
  NODE_ENV: 'test',
};

describe('telegram alerting', () => {
  beforeEach(() => {
    Object.assign(process.env, baseEnv);
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.restoreAllMocks();
  });

  it('returns false when env not configured', async () => {
    const { sendTelegram } = await import('./telegram.js');
    const result = await sendTelegram('hello');
    expect(result).toBe(false);
  });

  it('posts to telegram API when configured', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123:abc';
    process.env.TELEGRAM_CHAT_ID = '456';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { sendTelegram } = await import('./telegram.js');
    const result = await sendTelegram('hello');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chat_id).toBe('456');
    expect(body.text).toBe('hello');
  });

  it('swallows fetch errors (fire-and-forget)', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123:abc';
    process.env.TELEGRAM_CHAT_ID = '456';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const { sendTelegram } = await import('./telegram.js');
    const result = await sendTelegram('hello');
    expect(result).toBe(false); // does not throw
  });

  it('alertTelegram formats with severity prefix', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123:abc';
    process.env.TELEGRAM_CHAT_ID = '456';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { alertTelegram } = await import('./telegram.js');
    await alertTelegram('error', 'something broke', { foo: 'bar' });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain('🔴');
    expect(body.text).toContain('ERROR');
    expect(body.text).toContain('something broke');
    expect(body.text).toContain('"foo": "bar"');
  });
});
