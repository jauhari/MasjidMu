import { performance } from 'node:perf_hooks';

const base = process.env.API_BASE ?? 'http://localhost:3001';

function cookieHeader(setCookie: string | null): string {
  if (!setCookie) return '';
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0]!.trim())
    .join('; ');
}

async function time(label: string, url: string, cookie: string) {
  const t0 = performance.now();
  const r = await fetch(url, {
    credentials: 'include',
    headers: { 'X-Tenant-Slug': 'admin', Cookie: cookie },
    signal: AbortSignal.timeout(30_000),
  });
  const ms = Math.round(performance.now() - t0);
  console.log(`${label}: ${r.status} in ${ms}ms`);
}

const login = await fetch(`${base}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': 'admin' },
  body: JSON.stringify({ email: 'admin@masjidmu.id', password: 'MasjidMu@dev123' }),
});
const cookie = cookieHeader(login.headers.get('set-cookie'));
console.log('login:', login.status, cookie ? '(cookie ok)' : '(no cookie)');

if (!cookie) process.exit(1);

await time('get-session', `${base}/api/auth/get-session`, cookie);
await time('me', `${base}/api/v1/me`, cookie);
await time('announcements', `${base}/api/v1/announcements?status=published&limit=5`, cookie);
await time('posisi', `${base}/api/v1/reports/posisi-keuangan?month=6&year=2026`, cookie);
await time('aktivitas', `${base}/api/v1/reports/aktivitas?month=6&year=2026`, cookie);
await time('accounts-lite', `${base}/api/v1/accounts?lite=1`, cookie);
// second hit — should use in-memory caches
await time('posisi-cached', `${base}/api/v1/reports/posisi-keuangan?month=6&year=2026`, cookie);
await time('me-cached', `${base}/api/v1/me`, cookie);