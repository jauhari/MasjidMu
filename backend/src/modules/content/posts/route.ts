/**
 * Posts (berita & artikel) — module 9.
 *
 * Per-tenant CRUD with rich-text body, SEO fields, status (draft/published/
 * archived). publishedAt is auto-stamped when status flips to 'published'
 * (and not previously set).
 *
 * Listing supports `status` filter + simple ILIKE search on title/excerpt.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { posts } from '../../../db/schema/content.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';
import { pickFreeSlug, slugify } from '../../../lib/slug.js';
import { resolveActingUser } from '../../../lib/user-mapping.js';

const STATUS = ['draft', 'published', 'archived'] as const;

const createSchema = z.object({
  title: z.string().min(2).max(200),
  slug: z.string().max(200).optional(),
  excerpt: z.string().max(500).nullable().optional(),
  body: z.string().min(1),
  coverUrl: z.string().url().nullable().optional(),
  seoTitle: z.string().max(200).nullable().optional(),
  seoDescription: z.string().max(500).nullable().optional(),
  status: z.enum(STATUS).default('draft'),
});

const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  status: z.enum(STATUS).optional(),
  search: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const postsRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/', zValidator('query', listQuerySchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const q = c.req.valid('query');
    const rows = await withTenant(tenantId, async (tx) => {
      const conds = [isNull(posts.deletedAt)];
      if (q.status) conds.push(eq(posts.status, q.status));
      if (q.search) {
        const term = `%${q.search}%`;
        conds.push(
          or(sql`${posts.title} ILIKE ${term}`, sql`${posts.excerpt} ILIKE ${term}`)!,
        );
      }
      return tx
        .select()
        .from(posts)
        .where(and(...conds))
        .orderBy(desc(posts.publishedAt), desc(posts.createdAt))
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
        .from(posts)
        .where(and(eq(posts.id, id), isNull(posts.deletedAt)));
      return r[0] ?? null;
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: row });
  })

  .post('/', requirePermission('posts.manage'), zValidator('json', createSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const authUser = c.get('user')!;
    const tenantUser = await resolveActingUser(authUser, tenantId, !!c.get('isSuperAdmin'));
    if (!tenantUser) return c.json({ error: 'tenant_user_missing' }, 422);
    const body = c.req.valid('json');
    const created = await withTenant(tenantId, async (tx) => {
      const base = slugify(body.slug ?? body.title);
      const taken = await tx
        .select({ slug: posts.slug })
        .from(posts)
        .where(and(eq(posts.tenantId, tenantId), like(posts.slug, `${base}%`)));
      const slug = pickFreeSlug(taken.map((t) => t.slug), base);
      const [r] = await tx
        .insert(posts)
        .values({
          tenantId,
          title: body.title,
          slug,
          excerpt: body.excerpt ?? null,
          body: body.body,
          coverUrl: body.coverUrl ?? null,
          seoTitle: body.seoTitle ?? null,
          seoDescription: body.seoDescription ?? null,
          status: body.status,
          publishedAt: body.status === 'published' ? new Date() : null,
          createdBy: tenantUser.id,
        })
        .returning();
      return r!;
    });
    return c.json({ data: created }, 201);
  })

  .patch('/:id', requirePermission('posts.manage'), zValidator('json', updateSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const updated = await withTenant(tenantId, async (tx) => {
      const current = await tx
        .select()
        .from(posts)
        .where(and(eq(posts.id, id), isNull(posts.deletedAt)));
      const before = current[0];
      if (!before) return null;

      const next: Partial<typeof posts.$inferInsert> = { updatedAt: new Date() };
      if (body.title !== undefined) next.title = body.title;
      if (body.excerpt !== undefined) next.excerpt = body.excerpt;
      if (body.body !== undefined) next.body = body.body;
      if (body.coverUrl !== undefined) next.coverUrl = body.coverUrl;
      if (body.seoTitle !== undefined) next.seoTitle = body.seoTitle;
      if (body.seoDescription !== undefined) next.seoDescription = body.seoDescription;
      if (body.slug !== undefined) {
        const base = slugify(body.slug);
        const taken = await tx
          .select({ slug: posts.slug })
          .from(posts)
          .where(and(eq(posts.tenantId, tenantId), like(posts.slug, `${base}%`)));
        next.slug = pickFreeSlug(taken.map((t) => t.slug), base);
      }
      if (body.status !== undefined) {
        next.status = body.status;
        // Stamp publishedAt on first transition to 'published'.
        if (body.status === 'published' && !before.publishedAt) {
          next.publishedAt = new Date();
        }
      }
      const [r] = await tx
        .update(posts)
        .set(next)
        .where(eq(posts.id, id))
        .returning();
      return r!;
    });
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: updated });
  })

  .delete('/:id', requirePermission('posts.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const deleted = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(posts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: { id: deleted.id } });
  });
