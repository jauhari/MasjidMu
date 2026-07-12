/**
 * Cloudflare Pages Function — reverse-proxy `/api/*` → backend Node (Railway/Render/…).
 *
 * Same-origin keeps better-auth cookies working without cross-subdomain setup.
 * Set env `API_ORIGIN` on the Pages project (e.g. https://api.hisabmu.id).
 *
 * Path: /api/v1/me  →  ${API_ORIGIN}/api/v1/me
 */
type PagesContext = {
  request: Request;
  env: { API_ORIGIN?: string };
};

export async function onRequest(context: PagesContext): Promise<Response> {
  const apiOrigin = (context.env.API_ORIGIN || '').replace(/\/$/, '');
  if (!apiOrigin) {
    return new Response(
      JSON.stringify({
        error: 'api_origin_missing',
        detail:
          'Set Pages env API_ORIGIN to your Hono backend base URL (e.g. https://api.hisabmu.id)',
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
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));

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
