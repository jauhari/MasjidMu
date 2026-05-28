/**
 * Users module — per-tenant CRUD.
 *
 * All routes require active tenant context + session + permission. The list
 * goes through `withTenant` so RLS scopes results to the current tenant only.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { users } from '../../../db/schema/core.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';

const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  status: z.enum(['active', 'inactive', 'invited']).optional(),
});

export const usersRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/', requirePermission('users.read'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const rows = await withTenant(tenantId, async (tx) =>
      tx.select().from(users).where(isNull(users.deletedAt)),
    );
    return c.json({ data: rows });
  })

  .get('/:id', requirePermission('users.read'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const row = await withTenant(tenantId, async (tx) => {
      const r = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)));
      return r[0] ?? null;
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: row });
  })

  .patch('/:id', requirePermission('users.update'), zValidator('json', updateSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const updated = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(users)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: updated });
  });
