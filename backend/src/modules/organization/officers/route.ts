/**
 * Officers (pengurus) — module 3, part 3.
 *
 * Routes:
 *   GET    /api/v1/officers?periodId=&positionId=
 *   GET    /api/v1/officers/:id
 *   POST   /api/v1/officers
 *   PATCH  /api/v1/officers/:id
 *   DELETE /api/v1/officers/:id        soft delete (cascades documents at DB level)
 *
 *   POST   /api/v1/officers/:id/documents     attach SK file
 *   GET    /api/v1/officers/:id/documents     list
 *   DELETE /api/v1/officers/:id/documents/:docId   hard delete (file metadata only)
 *
 * Officer must reference a non-deleted period + position in same tenant. We
 * verify before insert/update because we can't FK on (tenantId, *) directly
 * given the cross-tenant references column shapes.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { officerDocuments, officers, periods, positions } from '../../../db/schema/organization.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';

const createSchema = z.object({
  periodId: z.string().uuid(),
  positionId: z.string().uuid(),
  name: z.string().min(2).max(200),
  photoUrl: z.string().url().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  bio: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  periodId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
});

const documentSchema = z.object({
  title: z.string().min(2).max(200),
  fileUrl: z.string().url(),
  fileSize: z.number().int().min(0).nullable().optional(),
  mimeType: z.string().max(100).nullable().optional(),
});

export const officersRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/', zValidator('query', listQuerySchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const q = c.req.valid('query');
    const rows = await withTenant(tenantId, async (tx) => {
      const conds = [isNull(officers.deletedAt)];
      if (q.periodId) conds.push(eq(officers.periodId, q.periodId));
      if (q.positionId) conds.push(eq(officers.positionId, q.positionId));
      return tx
        .select()
        .from(officers)
        .where(and(...conds))
        .orderBy(asc(officers.sortOrder), asc(officers.name));
    });
    return c.json({ data: rows });
  })

  .get('/:id', async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const row = await withTenant(tenantId, async (tx) => {
      const r = await tx
        .select()
        .from(officers)
        .where(and(eq(officers.id, id), isNull(officers.deletedAt)));
      return r[0] ?? null;
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: row });
  })

  .post(
    '/',
    requirePermission('officers.manage'),
    zValidator('json', createSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const body = c.req.valid('json');
      const result = await withTenant(tenantId, async (tx) => {
        const period = await tx
          .select({ id: periods.id })
          .from(periods)
          .where(and(eq(periods.id, body.periodId), isNull(periods.deletedAt)));
        if (!period[0]) return { error: 'period_not_found' as const };
        const pos = await tx
          .select({ id: positions.id })
          .from(positions)
          .where(and(eq(positions.id, body.positionId), isNull(positions.deletedAt)));
        if (!pos[0]) return { error: 'position_not_found' as const };
        const [r] = await tx
          .insert(officers)
          .values({
            tenantId,
            periodId: body.periodId,
            positionId: body.positionId,
            name: body.name,
            photoUrl: body.photoUrl ?? null,
            phone: body.phone ?? null,
            email: body.email ?? null,
            bio: body.bio ?? null,
            sortOrder: body.sortOrder,
          })
          .returning();
        return { row: r! };
      });
      if ('error' in result) return c.json({ error: result.error }, 400);
      return c.json({ data: result.row }, 201);
    },
  )

  .patch(
    '/:id',
    requirePermission('officers.manage'),
    zValidator('json', updateSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const result = await withTenant(tenantId, async (tx) => {
        if (body.periodId) {
          const p = await tx
            .select({ id: periods.id })
            .from(periods)
            .where(and(eq(periods.id, body.periodId), isNull(periods.deletedAt)));
          if (!p[0]) return { error: 'period_not_found' as const };
        }
        if (body.positionId) {
          const p = await tx
            .select({ id: positions.id })
            .from(positions)
            .where(and(eq(positions.id, body.positionId), isNull(positions.deletedAt)));
          if (!p[0]) return { error: 'position_not_found' as const };
        }
        const next: Partial<typeof officers.$inferInsert> = { updatedAt: new Date() };
        if (body.periodId !== undefined) next.periodId = body.periodId;
        if (body.positionId !== undefined) next.positionId = body.positionId;
        if (body.name !== undefined) next.name = body.name;
        if (body.photoUrl !== undefined) next.photoUrl = body.photoUrl;
        if (body.phone !== undefined) next.phone = body.phone;
        if (body.email !== undefined) next.email = body.email;
        if (body.bio !== undefined) next.bio = body.bio;
        if (body.sortOrder !== undefined) next.sortOrder = body.sortOrder;
        const [r] = await tx
          .update(officers)
          .set(next)
          .where(and(eq(officers.id, id), isNull(officers.deletedAt)))
          .returning();
        return r ? { row: r } : { error: 'not_found' as const };
      });
      if ('error' in result) {
        return c.json({ error: result.error }, result.error === 'not_found' ? 404 : 400);
      }
      return c.json({ data: result.row });
    },
  )

  .delete('/:id', requirePermission('officers.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const deleted = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(officers)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(officers.id, id), isNull(officers.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: { id: deleted.id } });
  })

  // ─── Documents (SK uploads) ─────────────────────────────────────────────
  .get('/:id/documents', async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const rows = await withTenant(tenantId, async (tx) =>
      tx
        .select()
        .from(officerDocuments)
        .where(eq(officerDocuments.officerId, id))
        .orderBy(desc(officerDocuments.createdAt)),
    );
    return c.json({ data: rows });
  })

  .post(
    '/:id/documents',
    requirePermission('officers.manage'),
    zValidator('json', documentSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const result = await withTenant(tenantId, async (tx) => {
        const off = await tx
          .select({ id: officers.id })
          .from(officers)
          .where(and(eq(officers.id, id), isNull(officers.deletedAt)));
        if (!off[0]) return { error: 'officer_not_found' as const };
        const [r] = await tx
          .insert(officerDocuments)
          .values({
            tenantId,
            officerId: id,
            title: body.title,
            fileUrl: body.fileUrl,
            fileSize: body.fileSize ?? null,
            mimeType: body.mimeType ?? null,
          })
          .returning();
        return { row: r! };
      });
      if ('error' in result) return c.json({ error: result.error }, 404);
      return c.json({ data: result.row }, 201);
    },
  )

  .delete('/:id/documents/:docId', requirePermission('officers.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const docId = c.req.param('docId');
    const deleted = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .delete(officerDocuments)
        .where(and(eq(officerDocuments.id, docId), eq(officerDocuments.officerId, id)))
        .returning();
      return r ?? null;
    });
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: { id: deleted.id } });
  });
