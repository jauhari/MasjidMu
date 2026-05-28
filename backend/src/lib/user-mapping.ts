/**
 * Sync layer between better-auth's `auth.user` (global identity) and
 * our `users` table (per-tenant profile + permissions).
 *
 * One auth user can map to ZERO or MORE tenant users:
 *   - Super admin: 0 tenant rows (uses asSuperAdmin context)
 *   - Single-mosque user: 1 row
 *   - User with multiple mosques: 1 row per tenant
 *
 * `ensureUserMapping(authUserId, tenantId)` is called when:
 *   - First sign-in to a tenant (before tenant context is fully active)
 *   - Tenant invitation acceptance
 *
 * This is idempotent and safe to call on every sign-in.
 */
import { and, eq } from 'drizzle-orm';
import { asSuperAdmin } from '../db/client.js';
import { users, type User } from '../db/schema/core.js';

export interface AuthUserSnapshot {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

/** Look up the app-side `users` row for an auth user within a tenant. */
export async function findTenantUser(
  authUserId: string,
  tenantId: string,
): Promise<User | null> {
  return asSuperAdmin(async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(and(eq(users.authUserId, authUserId), eq(users.tenantId, tenantId)));
    return rows[0] ?? null;
  });
}

/**
 * Create-or-update the app-side `users` row for `(authUserId, tenantId)`.
 * Returns the resulting `users` row.
 *
 * If a row already exists, refreshes name/email/lastLoginAt from the auth
 * snapshot and clears `deletedAt`.
 */
export async function ensureUserMapping(
  auth: AuthUserSnapshot,
  tenantId: string,
): Promise<User> {
  return asSuperAdmin(async (tx) => {
    const existing = await tx
      .select()
      .from(users)
      .where(and(eq(users.authUserId, auth.id), eq(users.tenantId, tenantId)));

    if (existing[0]) {
      const [updated] = await tx
        .update(users)
        .set({
          email: auth.email,
          name: auth.name,
          avatarUrl: auth.image ?? existing[0].avatarUrl,
          lastLoginAt: new Date(),
          deletedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing[0].id))
        .returning();
      return updated!;
    }

    const [created] = await tx
      .insert(users)
      .values({
        tenantId,
        authUserId: auth.id,
        email: auth.email,
        name: auth.name,
        status: 'active',
        lastLoginAt: new Date(),
      })
      .returning();
    return created!;
  });
}
