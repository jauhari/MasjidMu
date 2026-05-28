/**
 * Galleries (album foto/video) — module 10.
 *
 * Per-tenant CRUD for galleries; nested CRUD for items.
 *
 * Routes:
 *   GET    /api/v1/galleries
 *   GET    /api/v1/galleries/:id          (includes items, sorted by sortOrder)
 *   POST   /api/v1/galleries
 *   PATCH  /api/v1/galleries/:id
 *   DELETE /api/v1/galleries/:id          soft-delete (items cascade only on hard delete)
 *
 *   POST   /api/v1/galleries/:id/items
 *   PATCH  /api/v1/galleries/:id/items/:itemId
 *   DELETE /api/v1/galleries/:id/items/:itemId
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, asc, desc, eq, isNull, like } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { galleries, galleryItems } from '../../../db/schema/content.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';
import { pickFreeSlug, slugify } from '../../../lib/slug.js';

const galleryCreateSchema = z.object({
  title: z.string().min(2).max(200),
  slug: z.string().max(200).optional(),
  description: z.string().nullable().optional(),
  coverUrl: z.string().url().nullable().optional(),
  isPublic: z.boolean().default(true),
});

const galleryUpdateSchema = galleryCreateSchema.partial();

const itemCreateSchema = z.object({
  fileUrl: z.string().url(),
  caption: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

const itemUpdateSchema = itemCreateSchema.partial();

export const galleriesRoute = new Hono<{
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
        .from(galleries)
        .where(isNull(galleries.deletedAt))
        .orderBy(desc(galleries.createdAt)),
    );
    return c.json({ data: rows });
  })

  .get('/:id', async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const result = await withTenant(tenantId, async (tx) => {
      const g = await tx
        .select()
        .from(galleries)
        .where(and(eq(galleries.id, id), isNull(galleries.deletedAt)));
      if (!g[0]) return null;
      const items = await tx
        .select()
        .from(galleryItems)
        .where(eq(galleryItems.galleryId, id))
        .orderBy(asc(galleryItems.sortOrder), asc(galleryItems.createdAt));
      return { ...g[0], items };
    });
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: result });
  })

  .post(
    '/',
    requirePermission('galleries.manage'),
    zValidator('json', galleryCreateSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const body = c.req.valid('json');
      const created = await withTenant(tenantId, async (tx) => {
        const base = slugify(body.slug ?? body.title);
        const taken = await tx
          .select({ slug: galleries.slug })
          .from(galleries)
          .where(and(eq(galleries.tenantId, tenantId), like(galleries.slug, `${base}%`)));
        const slug = pickFreeSlug(taken.map((t) => t.slug), base);
        const [r] = await tx
          .insert(galleries)
          .values({
            tenantId,
            title: body.title,
            slug,
            description: body.description ?? null,
            coverUrl: body.coverUrl ?? null,
            isPublic: body.isPublic,
          })
          .returning();
        return r!;
      });
      return c.json({ data: created }, 201);
    },
  )

  .patch(
    '/:id',
    requirePermission('galleries.manage'),
    zValidator('json', galleryUpdateSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const updated = await withTenant(tenantId, async (tx) => {
        const next: Partial<typeof galleries.$inferInsert> = { updatedAt: new Date() };
        if (body.title !== undefined) next.title = body.title;
        if (body.description !== undefined) next.description = body.description;
        if (body.coverUrl !== undefined) next.coverUrl = body.coverUrl;
        if (body.isPublic !== undefined) next.isPublic = body.isPublic;
        if (body.slug !== undefined) {
          const base = slugify(body.slug);
          const taken = await tx
            .select({ slug: galleries.slug })
            .from(galleries)
            .where(and(eq(galleries.tenantId, tenantId), like(galleries.slug, `${base}%`)));
          next.slug = pickFreeSlug(taken.map((t) => t.slug), base);
        }
        const [r] = await tx
          .update(galleries)
          .set(next)
          .where(and(eq(galleries.id, id), isNull(galleries.deletedAt)))
          .returning();
        return r ?? null;
      });
      if (!updated) return c.json({ error: 'not_found' }, 404);
      return c.json({ data: updated });
    },
  )

  .delete('/:id', requirePermission('galleries.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const deleted = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(galleries)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(galleries.id, id), isNull(galleries.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: { id: deleted.id } });
  })

  // ─── Items ──────────────────────────────────────────────────────────────
  .post(
    '/:id/items',
    requirePermission('galleries.manage'),
    zValidator('json', itemCreateSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const result = await withTenant(tenantId, async (tx) => {
        const g = await tx
          .select({ id: galleries.id })
          .from(galleries)
          .where(and(eq(galleries.id, id), isNull(galleries.deletedAt)));
        if (!g[0]) return { error: 'gallery_not_found' as const };
        const [r] = await tx
          .insert(galleryItems)
          .values({
            galleryId: id,
            fileUrl: body.fileUrl,
            caption: body.caption ?? null,
            sortOrder: body.sortOrder,
          })
          .returning();
        return { row: r! };
      });
      if ('error' in result) return c.json({ error: result.error }, 404);
      return c.json({ data: result.row }, 201);
    },
  )

  .patch(
    '/:id/items/:itemId',
    requirePermission('galleries.manage'),
    zValidator('json', itemUpdateSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const itemId = c.req.param('itemId');
      const body = c.req.valid('json');
      const updated = await withTenant(tenantId, async (tx) => {
        const next: Partial<typeof galleryItems.$inferInsert> = {};
        if (body.fileUrl !== undefined) next.fileUrl = body.fileUrl;
        if (body.caption !== undefined) next.caption = body.caption;
        if (body.sortOrder !== undefined) next.sortOrder = body.sortOrder;
        if (Object.keys(next).length === 0) return null;
        const [r] = await tx
          .update(galleryItems)
          .set(next)
          .where(and(eq(galleryItems.id, itemId), eq(galleryItems.galleryId, id)))
          .returning();
        return r ?? null;
      });
      if (!updated) return c.json({ error: 'not_found' }, 404);
      return c.json({ data: updated });
    },
  )

  .delete('/:id/items/:itemId', requirePermission('galleries.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const itemId = c.req.param('itemId');
    const deleted = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .delete(galleryItems)
        .where(and(eq(galleryItems.id, itemId), eq(galleryItems.galleryId, id)))
        .returning();
      return r ?? null;
    });
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: { id: deleted.id } });
  });
