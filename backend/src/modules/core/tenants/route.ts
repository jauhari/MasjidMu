/**
 * Tenants module — super_admin only.
 *
 * Routes:
 *   GET    /api/v1/tenants            list (super_admin)
 *   POST   /api/v1/tenants            create (super_admin)
 *   GET    /api/v1/tenants/:id        detail (super_admin)
 *   PATCH  /api/v1/tenants/:id        update (super_admin)
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { asSuperAdmin } from '../../../db/client.js';
import { tenants } from '../../../db/schema/core.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';
import type { TenantVars } from '../../../middleware/tenant.js';

const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits, hyphens; cannot start with hyphen')
  .refine((s) => !['api', 'admin', 'www'].includes(s), 'reserved subdomain');

const createSchema = z.object({
  slug: slugSchema,
  name: z.string().min(2).max(200),
  shortName: z.string().max(100).optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  shortName: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const tenantsRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requirePermission('tenants.read'))
  .use('*', auditInterceptor())

  .get('/', async (c) => {
    const rows = await asSuperAdmin(async (tx) =>
      tx.select().from(tenants).where(isNull(tenants.deletedAt)),
    );
    return c.json({ data: rows });
  })

  .post('/', requirePermission('tenants.create'), zValidator('json', createSchema), async (c) => {
    const body = c.req.valid('json');
    const created = await asSuperAdmin(async (tx) => {
      const exists = await tx.select().from(tenants).where(eq(tenants.slug, body.slug));
      if (exists[0]) {
        return null;
      }
      const [r] = await tx.insert(tenants).values(body).returning();
      return r!;
    });
    if (!created) return c.json({ error: 'slug_taken', slug: body.slug }, 409);
    return c.json({ data: created }, 201);
  })

  .get('/:id', async (c) => {
    const id = c.req.param('id');
    const row = await asSuperAdmin(async (tx) => {
      const r = await tx
        .select()
        .from(tenants)
        .where(and(eq(tenants.id, id), isNull(tenants.deletedAt)));
      return r[0] ?? null;
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: row });
  })

  .patch('/:id', requirePermission('tenants.update'), zValidator('json', updateSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const updated = await asSuperAdmin(async (tx) => {
      const [r] = await tx
        .update(tenants)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(tenants.id, id), isNull(tenants.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: updated });
  });
