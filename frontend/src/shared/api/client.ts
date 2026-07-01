/**
 * API client — single fetch wrapper used by every feature.
 *
 * - All requests target `/api/v1/...` (relative URLs so the dev proxy works)
 * - `credentials: 'include'` so the better-auth cookie is sent
 * - Sends `X-Tenant-Slug` so backend tenantResolver can scope queries in dev
 * - GET dedup + short TTL cache to avoid duplicate in-flight/reference fetches
 * - 15s timeout so hung requests don't spin forever
 */

export type ApiError = Error & { status: number; body: unknown };

export function formatApiError(err: unknown, fallback = 'Terjadi kesalahan'): string {
  const e = err as { body?: { error?: string }; message?: string; name?: string };
  if (e?.name === 'TimeoutError' || e?.message?.toLowerCase().includes('timed out')) {
    return 'Koneksi ke server terlalu lama. Pastikan backend berjalan di port 3001, lalu muat ulang.';
  }
  return e?.body?.error ?? e?.message ?? fallback;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

let tenantSlug: string | null = null;

const STORAGE_KEY = 'masjidmu.tenantSlug';
const REQUEST_TIMEOUT_MS = 15_000;
const GET_CACHE_TTL_MS = 30_000;
const GET_CACHE_TTL_REF_MS = 5 * 60_000;

function getCacheTtl(url: string): number {
  if (
    url.includes('/api/v1/accounts') ||
    url.includes('/api/v1/transaction-categories') ||
    url.includes('/api/v1/funds')
  ) {
    return GET_CACHE_TTL_REF_MS;
  }
  return GET_CACHE_TTL_MS;
}

const inFlightGets = new Map<string, Promise<unknown>>();
const getCache = new Map<string, { at: number; data: unknown }>();

if (typeof window !== 'undefined') {
  tenantSlug = window.localStorage.getItem(STORAGE_KEY);
  if (tenantSlug === 'admin') {
    tenantSlug = 'al-uula';
    window.localStorage.setItem(STORAGE_KEY, 'al-uula');
  }
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

export function clearApiGetCache(): void {
  getCache.clear();
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
  const { body, query, headers, method = 'GET', ...rest } = opts;
  const url = buildUrl(path, query);
  const isGet = method === 'GET';

  if (isGet) {
    const cached = getCache.get(url);
    if (cached && Date.now() - cached.at < getCacheTtl(url)) {
      return cached.data as T;
    }
    const existing = inFlightGets.get(url);
    if (existing) return existing as Promise<T>;
  }

  const run = async (): Promise<T> => {
    const baseHeaders: Record<string, string> = {};
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isFormData) baseHeaders['Content-Type'] = 'application/json';
    if (tenantSlug) baseHeaders['X-Tenant-Slug'] = tenantSlug;

    const res = await fetch(url, {
      credentials: 'include',
      method,
      headers: {
        ...baseHeaders,
        ...headers,
      },
      body:
        body === undefined
          ? undefined
          : isFormData
            ? (body as FormData)
            : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

    if (isGet) {
      getCache.set(url, { at: Date.now(), data: parsed });
    } else {
      clearApiGetCache();
    }

    return parsed as T;
  };

  if (!isGet) return run();

  const promise = run();
  inFlightGets.set(url, promise);
  try {
    return await promise;
  } finally {
    inFlightGets.delete(url);
  }
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
  deleteWithBody: <T>(path: string, body?: unknown, opts: RequestOptions = {}) =>
    request<T>(path, { ...opts, method: 'DELETE', body }),
};