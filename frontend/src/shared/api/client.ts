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
  const e = err as {
    body?: {
      error?: string | { name?: string; message?: string; issues?: Array<{ path?: (string | number)[]; message?: string }> };
      detail?: string;
      success?: boolean;
    };
    message?: string;
    name?: string;
  };
  if (e?.name === 'TimeoutError' || e?.message?.toLowerCase().includes('timed out')) {
    return 'Koneksi ke server terlalu lama. Pastikan backend berjalan di port 3001, lalu muat ulang.';
  }

  const body = e?.body;
  if (body?.detail && typeof body.detail === 'string') return body.detail;

  const errField = body?.error;
  if (typeof errField === 'string') {
    // Kadang backend kirim JSON string / ZodError.message berisi array issues
    try {
      const parsed = JSON.parse(errField) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((i: { path?: (string | number)[]; message?: string }) => {
            const p = i.path?.length ? `${i.path.join('.')}: ` : '';
            return `${p}${i.message ?? 'invalid'}`;
          })
          .join(' · ');
      }
    } catch {
      /* plain string */
    }
    // Jangan tampilkan blob ZodError mentah ke user
    if (errField.includes('ZodError') || errField.includes('"too_small"')) {
      return 'Data form tidak valid. Periksa kode, nama, dan field wajib.';
    }
    return errField;
  }

  if (errField && typeof errField === 'object') {
    const issues = errField.issues;
    if (Array.isArray(issues) && issues.length > 0) {
      return issues
        .map((i) => {
          const p = i.path?.length ? `${i.path.join('.')}: ` : '';
          return `${p}${i.message ?? 'invalid'}`;
        })
        .join(' · ');
    }
    if (typeof errField.message === 'string') {
      try {
        const parsed = JSON.parse(errField.message) as Array<{
          path?: (string | number)[];
          message?: string;
        }>;
        if (Array.isArray(parsed)) {
          return parsed
            .map((i) => {
              const p = i.path?.length ? `${i.path.join('.')}: ` : '';
              return `${p}${i.message ?? 'invalid'}`;
            })
            .join(' · ');
        }
      } catch {
        if (!errField.message.includes('"too_small"')) return errField.message;
      }
      return 'Data form tidak valid. Periksa kode, nama, dan field wajib.';
    }
  }

  return e?.message ?? fallback;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Override the default request timeout. Pass 0 to disable the client timeout. */
  timeoutMs?: number;
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

interface MultipartUploadOptions {
  query?: RequestOptions['query'];
  headers?: Record<string, string>;
  timeoutMs?: number;
  onUploadProgress?: (progress: { loaded: number; total: number }) => void;
  onUploadComplete?: () => void;
}

/** XHR is used only where the browser's real multipart upload progress is needed. */
export function postFormDataWithProgress<T>(
  path: string,
  form: FormData,
  options: MultipartUploadOptions = {},
): Promise<T> {
  const {
    query,
    headers = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
    onUploadProgress,
    onUploadComplete,
  } = options;
  const url = buildUrl(path, query);

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.timeout = timeoutMs;
    if (tenantSlug) xhr.setRequestHeader('X-Tenant-Slug', tenantSlug);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onUploadProgress?.({ loaded: event.loaded, total: event.total });
      }
    });
    xhr.upload.addEventListener('load', () => onUploadComplete?.());

    xhr.addEventListener('load', () => {
      let parsed: unknown;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        parsed = xhr.responseText;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        const err = new Error(`API ${xhr.status} ${path}`) as ApiError;
        err.status = xhr.status;
        err.body = parsed;
        reject(err);
        return;
      }

      clearApiGetCache();
      resolve(parsed as T);
    });
    xhr.addEventListener('timeout', () => {
      const err = new Error(`Request timed out after ${timeoutMs}ms`);
      err.name = 'TimeoutError';
      reject(err);
    });
    xhr.addEventListener('error', () => reject(new Error('Network request failed.')));
    xhr.addEventListener('abort', () => reject(new Error('Request aborted.')));
    xhr.send(form);
  });
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, query, headers, method = 'GET', timeoutMs = REQUEST_TIMEOUT_MS, signal, ...rest } = opts;
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
      ...rest,
      signal: signal ?? (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined),
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