/**
 * Pengumuman (Announcements) — module 8.
 *
 * Per-tenant CRUD with scope (public/internal/urgent) + status driven by
 * publishedAt:
 *   - publishedAt IS NULL OR publishedAt > NOW() → "draft" (or scheduled)
 *   - publishedAt <= NOW()                       → "published"
 *
 * Soft-delete via deletedAt. Slug is unique per-tenant; auto-generated from
 * title if omitted, with `-N` suffix on collision.
 *
 * Permission: announcements.manage for all writes; reads gated only by session.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, isNull, like, sql } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { announcements } from '../../../db/schema/content.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';

const SCOPE = ['public', 'internal', 'urgent'] as const;

const createSchema = z.object({
  title: z.string().min(2).max(200),
  body: z.string().min(1),
  slug: z.string().max(200).optional(),
  scope: z.enum(SCOPE).default('public'),
  publishedAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  scope: z.enum(SCOPE).optional(),
  status: z.enum(['draft', 'published', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Slugify title and ensure uniqueness within tenant. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180);
}

async function uniqueSlug(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  base: string,
): Promise<string> {
  const candidate = base || 'pengumuman';
  // Pull all matching slugs once; pick the next available numeric suffix.
  const taken = await tx
    .select({ slug: announcements.slug })
    .from(announcements)
    .where(and(eq(announcements.tenantId, tenantId), like(announcements.slug, `${candidate}%`)));
  const set = new Set(taken.map((r) => r.slug));
  if (!set.has(candidate)) return candidate;
  for (let i = 2; i < 1000; i++) {
    const next = `${candidate}-${i}`;
    if (!set.has(next)) return next;
  }
  // Extremely unlikely fallback.
  return `${candidate}-${Date.now()}`;
}

function withDerivedStatus<T extends { publishedAt: Date | null }>(row: T): T & { status: 'draft' | 'published' } {
  const now = Date.now();
  const status = row.publishedAt && row.publishedAt.getTime() <= now ? 'published' : 'draft';
  return { ...row, status };
}

export const announcementsRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/', zValidator('query', listQuerySchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const q = c.req.valid('query');
    const rows = await withTenant(tenantId, async (tx) => {
      const conds = [isNull(announcements.deletedAt)];
      if (q.scope) conds.push(eq(announcements.scope, q.scope));
      if (q.status === 'published') {
        conds.push(sql`${announcements.publishedAt} IS NOT NULL AND ${announcements.publishedAt} <= NOW()`);
      } else if (q.status === 'draft') {
        conds.push(sql`(${announcements.publishedAt} IS NULL OR ${announcements.publishedAt} > NOW())`);
      }
      return tx
        .select()
        .from(announcements)
        .where(and(...conds))
        .orderBy(desc(announcements.publishedAt), desc(announcements.createdAt))
        .limit(q.limit)
        .offset(q.offset);
    });
    return c.json({ data: rows.map(withDerivedStatus), meta: { limit: q.limit, offset: q.offset } });
  })

  .get('/:id', async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const row = await withTenant(tenantId, async (tx) => {
      const r = await tx
        .select()
        .from(announcements)
        .where(and(eq(announcements.id, id), isNull(announcements.deletedAt)));
      return r[0] ?? null;
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: withDerivedStatus(row) });
  })

  .post(
    '/',
    requirePermission('announcements.manage'),
    zValidator('json', createSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const userId = c.get('user')!.id;
      const body = c.req.valid('json');
      const created = await withTenant(tenantId, async (tx) => {
        const baseSlug = slugify(body.slug ?? body.title);
        const slug = await uniqueSlug(tx, tenantId, baseSlug);
        const [r] = await tx
          .insert(announcements)
          .values({
            tenantId,
            title: body.title,
            body: body.body,
            slug,
            scope: body.scope,
            publishedAt: body.publishedAt ? new Date(body.publishedAt) : null,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            createdBy: userId,
          })
          .returning();
        return r!;
      });
      return c.json({ data: withDerivedStatus(created) }, 201);
    },
  )

  .patch(
    '/:id',
    requirePermission('announcements.manage'),
    zValidator('json', updateSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const updated = await withTenant(tenantId, async (tx) => {
        const next: Partial<typeof announcements.$inferInsert> = { updatedAt: new Date() };
        if (body.title !== undefined) next.title = body.title;
        if (body.body !== undefined) next.body = body.body;
        if (body.scope !== undefined) next.scope = body.scope;
        if (body.publishedAt !== undefined) {
          next.publishedAt = body.publishedAt ? new Date(body.publishedAt) : null;
        }
        if (body.expiresAt !== undefined) {
          next.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
        }
        if (body.slug !== undefined) {
          const baseSlug = slugify(body.slug);
          next.slug = await uniqueSlug(tx, tenantId, baseSlug);
        }
        const [r] = await tx
          .update(announcements)
          .set(next)
          .where(and(eq(announcements.id, id), isNull(announcements.deletedAt)))
          .returning();
        return r ?? null;
      });
      if (!updated) return c.json({ error: 'not_found' }, 404);
      return c.json({ data: withDerivedStatus(updated) });
    },
  )

  .delete('/:id', requirePermission('announcements.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const deleted = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(announcements)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(announcements.id, id), isNull(announcements.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: { id: deleted.id } });
  });
