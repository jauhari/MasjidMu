/**
 * Cloudflare Pages Function — reverse-proxy `/api/*` → backend Node (Railway/Render/…).
 *
 * Same-origin keeps better-auth cookies working without cross-subdomain setup.
 * Set env `API_ORIGIN` on the Pages project (e.g. https://api.mizanmu.id).
 *
 * Path: /api/v1/me  →  ${API_ORIGIN}/api/v1/me
 */
type PagesContext = {
  request: Request;
  env: { API_ORIGIN?: string; PUBLIC_TENANT_PROXY_SECRET?: string };
};

function validTenantSlug(slug: string | null): string | null {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  return !['api', 'admin', 'app', 'www', 'mizanmu', 'hisabmu', 'masjidmu'].includes(slug) ? slug : null;
}

function tenantSlugFromHost(hostname: string): string | null {
  const host = hostname.toLowerCase();
  const m = host.match(/^([a-z0-9][a-z0-9-]*)\.(mizanmu|hisabmu|masjidmu)\.id$/);
  if (m) return validTenantSlug(m[1] ?? null);
  const m2 = host.match(/^([a-z0-9][a-z0-9-]*)\.pcmponjong\.id$/);
  if (m2 && m2[1] !== 'mizanmu') return validTenantSlug(m2[1] ?? null);
  return null;
}

async function signTenantSlug(secret: string, slug: string, ts: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${slug}.${ts}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const apiOrigin = (context.env.API_ORIGIN || '').replace(/\/$/, '');
  if (!apiOrigin) {
    return new Response(
      JSON.stringify({
        error: 'api_origin_missing',
        detail:
          'Set Pages env API_ORIGIN to your Hono backend base URL (e.g. https://api.mizanmu.id)',
      }),
      {
        status: 503,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    );
  }

  const incoming = new URL(context.request.url);
  const target = new URL(incoming.pathname + incoming.search, apiOrigin);

  const headers = new Headers(context.request.headers);
  headers.delete('host');
  const isPublicApi = incoming.pathname.startsWith('/api/public/');
  if (isPublicApi) headers.delete('x-tenant-slug');
  headers.delete('x-mizanmu-tenant-slug');
  headers.delete('x-mizanmu-tenant-ts');
  headers.delete('x-mizanmu-tenant-sig');
  headers.delete('x-hisabmu-tenant-slug');
  headers.delete('x-hisabmu-tenant-ts');
  headers.delete('x-hisabmu-tenant-sig');
  const tenantSlug = tenantSlugFromHost(incoming.hostname)
    ?? (isPublicApi ? validTenantSlug(incoming.searchParams.get('tenant_slug')) : null);
  headers.set('x-forwarded-host', tenantSlug && isPublicApi ? `${tenantSlug}.hisabmu.id` : incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));

  const origin = headers.get('origin');
  if (origin && incoming.pathname.startsWith('/api/auth/')) {
    if (origin.includes('pages.dev')) {
      headers.set('origin', 'https://hisabmu.pages.dev');
    }
  }

  if (tenantSlug && context.env.PUBLIC_TENANT_PROXY_SECRET) {
    const ts = String(Date.now());
    const sig = await signTenantSlug(context.env.PUBLIC_TENANT_PROXY_SECRET, tenantSlug, ts);
    headers.set('x-mizanmu-tenant-slug', tenantSlug);
    headers.set('x-mizanmu-tenant-ts', ts);
    headers.set('x-mizanmu-tenant-sig', sig);
    headers.set('x-hisabmu-tenant-slug', tenantSlug);
    headers.set('x-hisabmu-tenant-ts', ts);
    headers.set('x-hisabmu-tenant-sig', sig);
  }

  const method = context.request.method;
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    redirect: 'manual',
  };

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = context.request.body;
    init.duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), init);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'api_upstream_unreachable',
        detail: err instanceof Error ? err.message : String(err),
        target: target.origin,
      }),
      {
        status: 502,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    );
  }

  const outHeaders = new Headers(upstream.headers);
  outHeaders.set('cache-control', 'private, no-store');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
