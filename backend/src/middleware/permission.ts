/**
 * Permission middleware.
 *
 * Loads the current user's permission codes (via roles → role_permissions →
 * permissions) for the current tenant, caches in-process for 5 min, and
 * exposes a `requirePermission(code)` guard.
 *
 * In-memory (not Redis) — a per-instance cache is enough at single-instance
 * scale and removes a hard external dependency (any Upstash hiccup used to
 * fail every authenticated request closed). Revisit if this ever runs as
 * multiple instances needing a shared cache.
 *
 * Cache key: `perms:{tenantId}:{authUserId}`. Invalidate on role/permission
 * change in the relevant module.
 */
import type { MiddlewareHandler } from 'hono';
import { and, eq } from 'drizzle-orm';
import { asSuperAdmin } from '../db/client.js';
import { permissions, rolePermissions, roles, userRoles, users } from '../db/schema/core.js';
import { memGet, memSet, memDel } from '../lib/memory-cache.js';
import type { SessionVars } from './session.js';
import type { TenantVars } from './tenant.js';

export type PermissionVars = {
  permissions?: Set<string>;
  isSuperAdmin?: boolean;
};

const CACHE_TTL_SEC = 5 * 60;

async function loadPermissions(authUserId: string, tenantId: string): Promise<string[]> {
  return asSuperAdmin(async (tx) => {
    // Find tenant user
    const u = await tx
      .select()
      .from(users)
      .where(and(eq(users.authUserId, authUserId), eq(users.tenantId, tenantId)));
    if (!u[0]) return [];

    // user → roles → role_permissions → permissions
    // System roles (tenant_id IS NULL) are also considered.
    const rows = await tx
      .select({ code: permissions.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(userRoles.userId, u[0].id));

    return [...new Set(rows.map((r) => r.code))];
  });
}

async function loadAndCachePermissions(
  authUserId: string,
  tenantId: string,
): Promise<Set<string>> {
  const key = `perms:${tenantId}:${authUserId}`;

  const cached = memGet<string[] | '__empty__'>(key);
  if (cached === '__empty__') return new Set();
  if (Array.isArray(cached) && cached.length > 0) return new Set(cached);

  const perms = await loadPermissions(authUserId, tenantId);

  if (perms.length > 0) memSet(key, perms, CACHE_TTL_SEC);
  else memSet(key, '__empty__', 30);

  return new Set(perms);
}

const superAdminCacheKey = (authUserId: string) => `superadmin:${authUserId}`;

/** Check whether the current user has 'super_admin' role (tenant-agnostic). */
async function isSuperAdminForUser(authUserId: string): Promise<boolean> {
  const key = superAdminCacheKey(authUserId);

  const cached = memGet<string>(key);
  if (cached === '1') return true;
  if (cached === '0') return false;

  const isAdmin = await asSuperAdmin(async (tx) => {
    const r = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(users.authUserId, authUserId), eq(roles.code, 'super_admin')))
      .limit(1);
    return r.length > 0;
  });

  memSet(key, isAdmin ? '1' : '0', CACHE_TTL_SEC);

  return isAdmin;
}

/**
 * Loads permissions into request context. Must be used AFTER sessionResolver
 * and tenantResolver.
 */
export const permissionResolver = (): MiddlewareHandler<{
  Variables: SessionVars & TenantVars & PermissionVars;
}> =>
  async (c, next) => {
    const user = c.get('user');
    const tenantId = c.get('tenantId');

    if (!user) {
      // Unauthenticated — leave perms empty
      c.set('permissions', new Set());
      c.set('isSuperAdmin', false);
      await next();
      return;
    }

    const isAdmin = await isSuperAdminForUser(user.id);
    c.set('isSuperAdmin', isAdmin);

    if (tenantId) {
      const perms = await loadAndCachePermissions(user.id, tenantId);
      c.set('permissions', perms);
    } else {
      c.set('permissions', new Set());
    }

    await next();
  };

/** Guard: 403 unless current user has the given permission code. */
export const requirePermission = (
  code: string,
): MiddlewareHandler<{ Variables: SessionVars & PermissionVars }> =>
  async (c, next) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
    if (c.get('isSuperAdmin')) return next(); // super_admin bypass

    const perms = c.get('permissions');
    if (!perms || !perms.has(code)) {
      return c.json({ error: 'forbidden', required: code }, 403);
    }
    await next();
  };

/** Invalidate permission cache for a specific (tenant, user). */
export async function invalidatePermissionCache(
  authUserId: string,
  tenantId: string,
): Promise<void> {
  memDel(`perms:${tenantId}:${authUserId}`);
}
