/**
 * Periods (kepengurusan masa bakti) — module 3, part 1.
 *
 * Routes:
 *   GET    /api/v1/periods            list (active first, then by start_date desc)
 *   GET    /api/v1/periods/:id        detail
 *   POST   /api/v1/periods            create
 *   PATCH  /api/v1/periods/:id        update
 *   POST   /api/v1/periods/:id/activate   set active = true (clears others)
 *   DELETE /api/v1/periods/:id        soft delete
 *
 * Activation is exclusive per tenant — at most one active period at a time.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { periods } from '../../../db/schema/organization.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';

const createSchema = z
  .object({
    name: z.string().min(2).max(100),
    startDate: z.string().datetime(),
    endDate: z.string().datetime().nullable().optional(),
    isActive: z.boolean().default(false),
  })
  .refine((v) => !v.endDate || new Date(v.endDate) > new Date(v.startDate), {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  });

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().nullable().optional(),
});

export const periodsRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/', async (c) => {
    const tenantId = c.get('tenantId')!;
    const rows = await withTenant(tenantId, async (tx) =>
      tx
        .select()
        .from(periods)
        .where(isNull(periods.deletedAt))
        .orderBy(desc(periods.isActive), desc(periods.startDate)),
    );
    return c.json({ data: rows });
  })

  .get('/:id', async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const row = await withTenant(tenantId, async (tx) => {
      const r = await tx
        .select()
        .from(periods)
        .where(and(eq(periods.id, id), isNull(periods.deletedAt)));
      return r[0] ?? null;
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: row });
  })

  .post('/', requirePermission('periods.manage'), zValidator('json', createSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const body = c.req.valid('json');
    const created = await withTenant(tenantId, async (tx) => {
      if (body.isActive) {
        await tx
          .update(periods)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(eq(periods.tenantId, tenantId), eq(periods.isActive, true)));
      }
      const [r] = await tx
        .insert(periods)
        .values({
          tenantId,
          name: body.name,
          startDate: new Date(body.startDate),
          endDate: body.endDate ? new Date(body.endDate) : null,
          isActive: body.isActive,
        })
        .returning();
      return r!;
    });
    return c.json({ data: created }, 201);
  })

  .patch(
    '/:id',
    requirePermission('periods.manage'),
    zValidator('json', updateSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const updated = await withTenant(tenantId, async (tx) => {
        const next: Partial<typeof periods.$inferInsert> = { updatedAt: new Date() };
        if (body.name !== undefined) next.name = body.name;
        if (body.startDate !== undefined) next.startDate = new Date(body.startDate);
        if (body.endDate !== undefined) {
          next.endDate = body.endDate ? new Date(body.endDate) : null;
        }
        const [r] = await tx
          .update(periods)
          .set(next)
          .where(and(eq(periods.id, id), isNull(periods.deletedAt)))
          .returning();
        return r ?? null;
      });
      if (!updated) return c.json({ error: 'not_found' }, 404);
      return c.json({ data: updated });
    },
  )

  .post('/:id/activate', requirePermission('periods.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const activated = await withTenant(tenantId, async (tx) => {
      const target = await tx
        .select()
        .from(periods)
        .where(and(eq(periods.id, id), isNull(periods.deletedAt)));
      if (!target[0]) return null;
      // Clear active flag on others first.
      await tx
        .update(periods)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(periods.tenantId, tenantId), eq(periods.isActive, true), ne(periods.id, id)));
      const [r] = await tx
        .update(periods)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(periods.id, id))
        .returning();
      return r!;
    });
    if (!activated) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: activated });
  })

  .delete('/:id', requirePermission('periods.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const deleted = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(periods)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(and(eq(periods.id, id), isNull(periods.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: { id: deleted.id } });
  });
