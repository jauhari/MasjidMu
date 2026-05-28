/**
 * Tenant resolver middleware.
 *
 * Resolves the tenant ID for the current request based on subdomain:
 *   - `{slug}.masjidmu.id`  → look up tenant by slug
 *   - `localhost:3000`      → use X-Tenant-Slug header (dev convenience)
 *   - `api.masjidmu.id`     → no tenant context (admin endpoints, super_admin)
 *
 * Sets `c.var.tenant` and `c.var.tenantId`. Downstream code uses
 * `withTenant(c.var.tenantId, ...)` to scope DB queries.
 *
 * Routes that don't need tenant context (e.g. /api/auth/*, /healthz) should
 * register BEFORE this middleware.
 */
import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { asSuperAdmin } from '../db/client.js';
import { tenants, type Tenant } from '../db/schema/core.js';

const PUBLIC_HOSTS = new Set([
  'api.masjidmu.id',
  'admin.masjidmu.id',
]);

export type TenantVars = {
  tenant?: Tenant;
  tenantId?: string;
};

const cache = new Map<string, { tenant: Tenant; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function extractSlug(host: string, devHeaderSlug?: string): string | null {
  // Strip port
  const hostname = host.split(':')[0]!.toLowerCase();

  // Dev: localhost — use header if provided
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return devHeaderSlug?.toLowerCase() ?? null;
  }

  // Public host (no tenant)
  if (PUBLIC_HOSTS.has(hostname)) return null;

  // Subdomain extraction: {slug}.masjidmu.id
  const m = hostname.match(/^([a-z0-9][a-z0-9-]*)\.masjidmu\.id$/);
  if (m && m[1] !== 'api' && m[1] !== 'admin' && m[1] !== 'www') {
    return m[1];
  }

  return null;
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

export const tenantResolver = (): MiddlewareHandler<{ Variables: TenantVars }> =>
  async (c, next) => {
    const host = c.req.header('host') ?? '';
    const devHeader = c.req.header('x-tenant-slug') ?? undefined;
    const slug = extractSlug(host, devHeader);

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
