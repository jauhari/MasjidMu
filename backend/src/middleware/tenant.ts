/**
 * Tenant resolver middleware.
 *
 * Resolves the tenant ID for the current request based on subdomain:
 *   - `{slug}.hisabmu.id`  → look up tenant by slug
 *   - `localhost:3000`      → use X-Tenant-Slug header (dev convenience)
 *   - `api.hisabmu.id`     → no tenant context (admin endpoints, super_admin)
 *
 * Fallback for browser-initiated GETs (e.g. PDF/XLSX downloads via <a href>
 * where custom headers can't be set): `?tenant_slug=` query parameter is
 * accepted on dev hosts only.
 *
 * When no host/header/query resolves a slug at all, and the request carries
 * an authenticated session, falls back to the user's own tenant membership
 * (`users` row for their authUserId) — this is what lets login be just
 * email+password with no slug field: the client never needs to know or send
 * a tenant, the server looks up where this person actually belongs. Only
 * kicks in when that's unambiguous (exactly one membership); a super_admin
 * with several (or a regular user somehow given two) gets nothing here and
 * falls through to GOD-mode TenantSwitcher instead of a guess.
 *
 * Sets `c.var.tenant` and `c.var.tenantId`. Downstream code uses
 * `withTenant(c.var.tenantId, ...)` to scope DB queries.
 *
 * Routes that don't need tenant context (e.g. /api/auth/*, /healthz) should
 * register BEFORE this middleware.
 */
import type { MiddlewareHandler } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { asSuperAdmin } from '../db/client.js';
import { tenants, users, type Tenant } from '../db/schema/core.js';
import { env } from '../lib/env.js';
import { memGet, memSet } from '../lib/memory-cache.js';
import type { SessionVars } from './session.js';

const PUBLIC_HOSTS = new Set([
  'api.hisabmu.id',
  'admin.hisabmu.id',
]);

export type TenantVars = {
  tenant?: Tenant;
  tenantId?: string;
};

const cache = new Map<string, { tenant: Tenant; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;
const HOME_TENANT_CACHE_TTL_SEC = 60;

// Hosts without their own subdomain-per-tenant DNS yet — fall back to the
// header/query mechanism like localhost. TEMPORARY: remove once
// {slug}.hisabmu.id is live and every tenant has a real subdomain; safe in
// the meantime because permissionResolver still scopes by real
// (authUserId, tenantId) DB membership — a non-super-admin can't read another
// tenant's data just by sending a different header value.
const HEADER_FALLBACK_HOSTS = new Set(['masjidmu-backend.onrender.com']);

function signProxySlug(slug: string, ts: string): string {
  return createHmac('sha256', env.PUBLIC_TENANT_PROXY_SECRET ?? '')
    .update(`${slug}.${ts}`)
    .digest('hex');
}

function verifiedProxySlug(slug: string | undefined, ts: string | undefined, sig: string | undefined): string | null {
  if (!env.PUBLIC_TENANT_PROXY_SECRET || !slug || !ts || !sig) return null;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  const age = Math.abs(Date.now() - Number(ts));
  if (!Number.isFinite(age) || age > 5 * 60_000) return null;
  const expected = signProxySlug(slug.toLowerCase(), ts);
  const given = Buffer.from(sig, 'hex');
  const want = Buffer.from(expected, 'hex');
  if (given.length !== want.length) return null;
  return timingSafeEqual(given, want) ? slug.toLowerCase() : null;
}

function slugFromHost(host: string): string | null {
  const hostname = host.split(':')[0]!.toLowerCase();
  if (PUBLIC_HOSTS.has(hostname)) return null;
  const m = hostname.match(/^([a-z0-9][a-z0-9-]*)\.hisabmu\.id$/);
  if (m && m[1] !== 'api' && m[1] !== 'admin' && m[1] !== 'www') return m[1];
  return null;
}

function extractSlug(
  host: string,
  devHeaderSlug?: string,
  devQuerySlug?: string,
  proxySlug?: string,
  forwardedHost?: string,
  allowPublicForwardedHost = false,
): string | null {
  if (proxySlug) return proxySlug;
  // Strip port
  const hostname = host.split(':')[0]!.toLowerCase();

  // Dev: localhost — header takes precedence over query param
  if (hostname === 'localhost' || hostname === '127.0.0.1' || HEADER_FALLBACK_HOSTS.has(hostname)) {
    return (devHeaderSlug ?? devQuerySlug)?.toLowerCase()
      ?? (allowPublicForwardedHost ? slugFromHost(forwardedHost ?? '') : null)
      ?? null;
  }

  return slugFromHost(host);
}

async function resolveTenant(slug: string): Promise<Tenant | null> {
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.tenant;

  // Tenants table has no RLS, but we need super_admin to query reliably
  // (since current_tenant_id isn't set yet — that's what we're resolving).
  const t = await asSuperAdmin(async (tx) => {
    const rows = await tx.select().from(tenants).where(eq(tenants.slug, slug));
    return rows[0] ?? null;
  });

  if (t) cache.set(slug, { tenant: t, expiresAt: Date.now() + CACHE_TTL_MS });
  return t;
}

/**
 * A user's own tenant membership, for when no slug came from host/header/
 * query at all. Resolves ONLY when the user has exactly one `users` row
 * (one tenant membership) — the common case for a regular bendahara account.
 * Zero rows (pure super_admin) or two-plus (a person who happens to belong to
 * — or admins the platform into — more than one lembaga) both deliberately
 * resolve to nothing rather than guessing; those people use GOD-mode
 * TenantSwitcher to pick explicitly. Confirmed live on `admin@masjidmu.id`,
 * which really does hold two real memberships today — auto-picking either
 * one would have been wrong.
 */
async function resolveHomeTenantSlug(authUserId: string): Promise<string | null> {
  const cacheKey = `home-tenant:${authUserId}`;
  const cached = memGet<string | '__none__'>(cacheKey);
  if (cached === '__none__') return null;
  if (typeof cached === 'string') return cached;

  const slug = await asSuperAdmin(async (tx) => {
    const rows = await tx
      .select({ slug: tenants.slug })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
      .limit(2);
    return rows.length === 1 ? rows[0]!.slug : null;
  });

  memSet(cacheKey, slug ?? '__none__', HOME_TENANT_CACHE_TTL_SEC);
  return slug;
}

export const tenantResolver = (): MiddlewareHandler<{ Variables: SessionVars & TenantVars }> =>
  async (c, next) => {
    const host = c.req.header('host') ?? '';
    const isPublicApi = c.req.path.startsWith('/api/public/');
    const devHeader = isPublicApi ? undefined : c.req.header('x-tenant-slug') ?? undefined;
    const devQuery = isPublicApi ? undefined : c.req.query('tenant_slug') ?? undefined;
    const proxySlug = verifiedProxySlug(
      c.req.header('x-hisabmu-tenant-slug') ?? undefined,
      c.req.header('x-hisabmu-tenant-ts') ?? undefined,
      c.req.header('x-hisabmu-tenant-sig') ?? undefined,
    );
    let slug = extractSlug(
      host,
      devHeader,
      devQuery,
      proxySlug ?? undefined,
      c.req.header('x-forwarded-host') ?? undefined,
      isPublicApi,
    );

    if (!slug) {
      const user = c.get('user');
      if (user) slug = await resolveHomeTenantSlug(user.id);
    }

    if (slug) {
      const tenant = await resolveTenant(slug);
      if (!tenant || !tenant.isActive) {
        return c.json({ error: 'tenant_not_found', slug }, 404);
      }
      c.set('tenant', tenant);
      c.set('tenantId', tenant.id);
    }

    return next();
  };

/** Force tenant context to be present (404s otherwise). Use on tenant routes. */
export const requireTenant = (): MiddlewareHandler<{ Variables: TenantVars }> =>
  async (c, next) => {
    if (!c.get('tenantId')) {
      return c.json({ error: 'tenant_context_required' }, 400);
    }
    return next();
  };

export function _clearTenantCache() {
  cache.clear();
}
