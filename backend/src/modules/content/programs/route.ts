/**
 * Programs (program masjid) — module 6.
 *
 * Per-tenant CRUD. Status follows program_status enum (draft/active/completed/cancelled).
 * `collectedAmount` is meant to be derived from posted accounting transactions
 * tagged to this program — kept as a manual numeric for MVP; reconciliation
 * job (Sprint 7+) will sync it from journals.
 *
 * Public list (`isPublic = true AND status != 'draft'`) supports the public
 * portal without auth. We still gate the endpoint with session for now and
 * leave the public proxy for module 12 (Transparansi Publik).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, isNull, like } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { programs } from '../../../db/schema/content.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';
import { pickFreeSlug, slugify } from '../../../lib/slug.js';

const STATUS = ['draft', 'active', 'completed', 'cancelled'] as const;

const createSchema = z.object({
  title: z.string().min(2).max(200),
  slug: z.string().max(200).optional(),
  description: z.string().nullable().optional(),
  coverUrl: z.string().url().nullable().optional(),
  targetAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  status: z.enum(STATUS).default('draft'),
  isPublic: z.boolean().default(true),
});

const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  status: z.enum(STATUS).optional(),
  isPublic: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const programsRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/', zValidator('query', listQuerySchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const q = c.req.valid('query');
    const rows = await withTenant(tenantId, async (tx) => {
      const conds = [isNull(programs.deletedAt)];
      if (q.status) conds.push(eq(programs.status, q.status));
      if (q.isPublic !== undefined) conds.push(eq(programs.isPublic, q.isPublic));
      return tx
        .select()
        .from(programs)
        .where(and(...conds))
        .orderBy(desc(programs.createdAt))
        .limit(q.limit)
        .offset(q.offset);
    });
    return c.json({ data: rows, meta: { limit: q.limit, offset: q.offset } });
  })

  .get('/:id', async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const row = await withTenant(tenantId, async (tx) => {
      const r = await tx
        .select()
        .from(programs)
        .where(and(eq(programs.id, id), isNull(programs.deletedAt)));
      return r[0] ?? null;
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: row });
  })

  .post('/', requirePermission('programs.manage'), zValidator('json', createSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const created = await withTenant(tenantId, async (tx) => {
      const base = slugify(body.slug ?? body.title);
      const taken = await tx
        .select({ slug: programs.slug })
        .from(programs)
        .where(and(eq(programs.tenantId, tenantId), like(programs.slug, `${base}%`)));
      const slug = pickFreeSlug(taken.map((t) => t.slug), base);
      const [r] = await tx
        .insert(programs)
        .values({
          tenantId,
          title: body.title,
          slug,
          description: body.description ?? null,
          coverUrl: body.coverUrl ?? null,
          targetAmount: body.targetAmount ?? null,
          startDate: body.startDate ? new Date(body.startDate) : null,
          endDate: body.endDate ? new Date(body.endDate) : null,
          status: body.status,
          isPublic: body.isPublic,
          createdBy: userId,
        })
        .returning();
      return r!;
    });
    return c.json({ data: created }, 201);
  })

  .patch('/:id', requirePermission('programs.manage'), zValidator('json', updateSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const updated = await withTenant(tenantId, async (tx) => {
      const next: Partial<typeof programs.$inferInsert> = { updatedAt: new Date() };
      if (body.title !== undefined) next.title = body.title;
      if (body.description !== undefined) next.description = body.description;
      if (body.coverUrl !== undefined) next.coverUrl = body.coverUrl;
      if (body.targetAmount !== undefined) next.targetAmount = body.targetAmount;
      if (body.startDate !== undefined) next.startDate = body.startDate ? new Date(body.startDate) : null;
      if (body.endDate !== undefined) next.endDate = body.endDate ? new Date(body.endDate) : null;
      if (body.status !== undefined) next.status = body.status;
      if (body.isPublic !== undefined) next.isPublic = body.isPublic;
      if (body.slug !== undefined) {
        const base = slugify(body.slug);
        const taken = await tx
          .select({ slug: programs.slug })
          .from(programs)
          .where(and(eq(programs.tenantId, tenantId), like(programs.slug, `${base}%`)));
        next.slug = pickFreeSlug(taken.map((t) => t.slug), base);
      }
      const [r] = await tx
        .update(programs)
        .set(next)
        .where(and(eq(programs.id, id), isNull(programs.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: updated });
  })

  .delete('/:id', requirePermission('programs.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const deleted = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(programs)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(programs.id, id), isNull(programs.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: { id: deleted.id } });
  });
