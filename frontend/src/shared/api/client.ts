/**
 * API client — single fetch wrapper used by every feature.
 *
 * - All requests target `/api/v1/...` (relative URLs so the dev proxy works)
 * - `credentials: 'include'` so the better-auth cookie is sent
 * - Sends `X-Tenant-Slug` so backend tenantResolver can scope queries in dev
 *   (production resolves tenant from subdomain → header is ignored)
 * - Throws `ApiError` on non-2xx with the parsed body so callers can branch on
 *   error codes (e.g. `unauthenticated`, `not_found`)
 */

export type ApiError = Error & { status: number; body: unknown };

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * Active tenant slug for the current session. Set after login (or read from
 * `localStorage` on app boot). The auth store calls `setTenantSlug` so every
 * subsequent request carries the dev header.
 */
let tenantSlug: string | null = null;

const STORAGE_KEY = 'masjidmu.tenantSlug';

if (typeof window !== 'undefined') {
  tenantSlug = window.localStorage.getItem(STORAGE_KEY);
}

export function setTenantSlug(slug: string | null): void {
  tenantSlug = slug;
  if (typeof window !== 'undefined') {
    if (slug) window.localStorage.setItem(STORAGE_KEY, slug);
    else window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function getTenantSlug(): string | null {
  return tenantSlug;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = path.startsWith('/') ? path : `/${path}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = opts;
  const url = buildUrl(path, query);
  const baseHeaders: Record<string, string> = {};
  if (body !== undefined) baseHeaders['Content-Type'] = 'application/json';
  if (tenantSlug) baseHeaders['X-Tenant-Slug'] = tenantSlug;
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      ...baseHeaders,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...rest,
  });

  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const err = new Error(`API ${res.status} ${path}`) as ApiError;
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string, opts: RequestOptions = {}) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts: RequestOptions = {}) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts: RequestOptions = {}) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts: RequestOptions = {}) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};
