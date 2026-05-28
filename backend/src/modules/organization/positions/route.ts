/**
 * Positions (struktur jabatan) — module 3, part 2.
 *
 * Hierarchical positions per tenant. parentId is optional; when set, must
 * reference a non-deleted position in the same tenant.
 *
 * Routes:
 *   GET    /api/v1/positions          flat list, ordered by sort_order then name
 *   GET    /api/v1/positions/tree     nested tree (root nodes have parentId NULL)
 *   GET    /api/v1/positions/:id
 *   POST   /api/v1/positions
 *   PATCH  /api/v1/positions/:id
 *   DELETE /api/v1/positions/:id      soft delete (only if no active officers reference it)
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { officers, positions } from '../../../db/schema/organization.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';

const createSchema = z.object({
  name: z.string().min(2).max(200),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  description: z.string().nullable().optional(),
});

const updateSchema = createSchema.partial();

interface PositionNode {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  children: PositionNode[];
}

export const positionsRoute = new Hono<{
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
        .from(positions)
        .where(isNull(positions.deletedAt))
        .orderBy(asc(positions.sortOrder), asc(positions.name)),
    );
    return c.json({ data: rows });
  })

  .get('/tree', async (c) => {
    const tenantId = c.get('tenantId')!;
    const rows = await withTenant(tenantId, async (tx) =>
      tx
        .select()
        .from(positions)
        .where(isNull(positions.deletedAt))
        .orderBy(asc(positions.sortOrder), asc(positions.name)),
    );
    const byId = new Map<string, PositionNode>();
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        name: r.name,
        parentId: r.parentId,
        sortOrder: r.sortOrder,
        children: [],
      });
    }
    const roots: PositionNode[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return c.json({ data: roots });
  })

  .get('/:id', async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const row = await withTenant(tenantId, async (tx) => {
      const r = await tx
        .select()
        .from(positions)
        .where(and(eq(positions.id, id), isNull(positions.deletedAt)));
      return r[0] ?? null;
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: row });
  })

  .post(
    '/',
    requirePermission('positions.manage'),
    zValidator('json', createSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const body = c.req.valid('json');
      const created = await withTenant(tenantId, async (tx) => {
        if (body.parentId) {
          const parent = await tx
            .select({ id: positions.id })
            .from(positions)
            .where(and(eq(positions.id, body.parentId), isNull(positions.deletedAt)));
          if (!parent[0]) return { error: 'parent_not_found' as const };
        }
        const [r] = await tx
          .insert(positions)
          .values({
            tenantId,
            name: body.name,
            parentId: body.parentId ?? null,
            sortOrder: body.sortOrder,
            description: body.description ?? null,
          })
          .returning();
        return { row: r! };
      });
      if ('error' in created) return c.json({ error: created.error }, 400);
      return c.json({ data: created.row }, 201);
    },
  )

  .patch(
    '/:id',
    requirePermission('positions.manage'),
    zValidator('json', updateSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const result = await withTenant(tenantId, async (tx) => {
        if (body.parentId !== undefined && body.parentId !== null) {
          if (body.parentId === id) return { error: 'cannot_self_parent' as const };
          const parent = await tx
            .select({ id: positions.id })
            .from(positions)
            .where(and(eq(positions.id, body.parentId), isNull(positions.deletedAt)));
          if (!parent[0]) return { error: 'parent_not_found' as const };
        }
        const next: Partial<typeof positions.$inferInsert> = { updatedAt: new Date() };
        if (body.name !== undefined) next.name = body.name;
        if (body.parentId !== undefined) next.parentId = body.parentId;
        if (body.sortOrder !== undefined) next.sortOrder = body.sortOrder;
        if (body.description !== undefined) next.description = body.description;
        const [r] = await tx
          .update(positions)
          .set(next)
          .where(and(eq(positions.id, id), isNull(positions.deletedAt)))
          .returning();
        return r ? { row: r } : { error: 'not_found' as const };
      });
      if ('error' in result) {
        return c.json({ error: result.error }, result.error === 'not_found' ? 404 : 400);
      }
      return c.json({ data: result.row });
    },
  )

  .delete('/:id', requirePermission('positions.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const result = await withTenant(tenantId, async (tx) => {
      // Refuse if any active officers still reference this position.
      const occupied = await tx
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(officers)
        .where(and(eq(officers.positionId, id), isNull(officers.deletedAt)));
      if ((occupied[0]?.n ?? 0) > 0) {
        return { error: 'has_active_officers' as const, count: occupied[0]!.n };
      }
      // Refuse if any active children still parented under this.
      const kids = await tx
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(positions)
        .where(and(eq(positions.parentId, id), isNull(positions.deletedAt)));
      if ((kids[0]?.n ?? 0) > 0) {
        return { error: 'has_children' as const, count: kids[0]!.n };
      }
      const [r] = await tx
        .update(positions)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(positions.id, id), isNull(positions.deletedAt)))
        .returning();
      return r ? { row: r } : { error: 'not_found' as const };
    });
    if ('error' in result) {
      const status = result.error === 'not_found' ? 404 : 409;
      return c.json(result, status);
    }
    return c.json({ data: { id: result.row.id } });
  });
