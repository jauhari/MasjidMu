/**
 * Permission middleware.
 *
 * Loads the current user's permission codes (via roles → role_permissions →
 * permissions) for the current tenant, caches in Upstash for 5 min, and
 * exposes a `requirePermission(code)` guard.
 *
 * Cache key: `perms:{tenantId}:{authUserId}`. Invalidate on role/permission
 * change in the relevant module.
 */
import type { MiddlewareHandler } from 'hono';
import { and, eq } from 'drizzle-orm';
import { asSuperAdmin } from '../db/client.js';
import { permissions, rolePermissions, roles, userRoles, users } from '../db/schema/core.js';
import { redis } from '../lib/redis.js';
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
  const cached = await redis.smembers(key);
  if (cached.length > 0) {
    return new Set(cached);
  }

  const perms = await loadPermissions(authUserId, tenantId);
  if (perms.length > 0) {
    await redis.sadd(key, perms[0]!, ...perms.slice(1));
    await redis.expire(key, CACHE_TTL_SEC);
  } else {
    // Cache the empty result briefly so we don't hammer the DB on auth-failed users.
    await redis.set(key, '', { ex: 30 });
  }
  return new Set(perms);
}

/** Check whether the current user has 'super_admin' role (tenant-agnostic). */
async function isSuperAdminForUser(authUserId: string): Promise<boolean> {
  return asSuperAdmin(async (tx) => {
    // Super admin role has tenant_id NULL, code 'super_admin'.
    // We need to find ANY users row for this auth user (any tenant) that
    // has the super_admin system role granted. For MVP, super_admin lives
    // on a separate `auth.user.role = 'admin'` (better-auth admin plugin).
    // We can also check our own user_roles table.
    const u = await tx.select().from(users).where(eq(users.authUserId, authUserId));
    if (u.length === 0) return false;

    for (const row of u) {
      const r = await tx
        .select()
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(and(eq(userRoles.userId, row.id), eq(roles.code, 'super_admin')));
      if (r.length > 0) return true;
    }
    return false;
  });
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
  await redis.del(`perms:${tenantId}:${authUserId}`);
}
