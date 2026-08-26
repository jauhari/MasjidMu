/**
 * Team management — per-tenant CRUD for user membership.
 *
 * Routes:
 *   GET    /api/v1/team          list members
 *   POST   /api/v1/team/invite   invite by email
 *   DELETE /api/v1/team/:id      remove member (soft delete)
 *
 * Invitation flow:
 *   1. Admin calls POST /team/invite with email
 *   2. Backend creates `users` row with status='invited'
 *   3. Invitee signs up via /api/register or /api/auth/sign-up/email with same email
 *   4. On first login, `syncUserAuthId` links their auth account automatically
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { users, userRoles, roles } from '../../../db/schema/core.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';
import { logger } from '../../../lib/logger.js';

const inviteSchema = z.object({
  email: z.string().email('Email tidak valid'),
  name: z.string().min(2).max(200).optional(),
});

export const teamRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  // ─── List members ─────────────────────────────────────────────────────
  .get('/', requirePermission('users.read'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const rows = await withTenant(tenantId, async (tx) => {
      return tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
          status: users.status,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(isNull(users.deletedAt))
        .orderBy(users.createdAt);
    });

    // Load roles for each user
    const membersWithRoles = await withTenant(tenantId, async (tx) => {
      const results = await Promise.all(
        rows.map(async (row) => {
          const userRolesList = await tx
            .select({ roleCode: roles.code, roleName: roles.name })
            .from(userRoles)
            .innerJoin(roles, eq(userRoles.roleId, roles.id))
            .where(eq(userRoles.userId, row.id));
          return { ...row, roles: userRolesList.map((r) => ({ code: r.roleCode, name: r.roleName })) };
        }),
      );
      return results;
    });

    return c.json({ data: membersWithRoles });
  })

  // ─── Invite member ────────────────────────────────────────────────────
  .post('/invite', requirePermission('users.create'), zValidator('json', inviteSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const body = c.req.valid('json');
    const normalizedEmail = body.email.toLowerCase().trim();

    // Check if user already exists in this tenant
    const existing = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(and(eq(users.email, normalizedEmail), isNull(users.deletedAt)));
      return rows[0];
    });

    if (existing) {
      if (existing.status === 'invited') {
        return c.json({ error: 'already_invited', detail: 'Email ini sudah diundang.' }, 409);
      }
      return c.json({ error: 'already_member', detail: 'Email ini sudah menjadi anggota.' }, 409);
    }

    // Create invited user row
    const invited = await withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          tenantId,
          authUserId: `invited:${normalizedEmail}`, // placeholder until they sign up
          email: normalizedEmail,
          name: body.name ?? normalizedEmail.split('@')[0]!,
          status: 'invited',
        })
        .returning();
      return row;
    });

    logger.info({ tenantId, email: normalizedEmail, userId: invited.id }, 'team member invited');

    return c.json({ data: invited }, 201);
  })

  // ─── Remove member ────────────────────────────────────────────────────
  .delete('/:id', requirePermission('users.delete'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');

    // Prevent removing yourself
    const currentUserId = c.get('user')!.id;
    const target = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ id: users.id, authUserId: users.authUserId })
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)));
      return rows[0];
    });

    if (!target) return c.json({ error: 'not_found' }, 404);
    if (target.authUserId === currentUserId) {
      return c.json({ error: 'cannot_remove_self', detail: 'Tidak bisa menghapus diri sendiri.' }, 400);
    }

    // Soft-delete
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(users)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, id));
    });

    return c.json({ ok: true });
  });
