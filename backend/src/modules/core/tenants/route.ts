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
import { asSuperAdmin, withTenant } from '../../../db/client.js';
import { tenants } from '../../../db/schema/core.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';
import type { TenantVars } from '../../../middleware/tenant.js';
import { seedDefaultChart } from '../../accounting/accounts/service.js';
import { fundSeedOptionsForEdition, seedFunds } from '../../accounting/funds/service.js';
import { logger } from '../../../lib/logger.js';

const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits, hyphens; cannot start with hyphen')
  .refine((s) => !['api', 'admin', 'www'].includes(s), 'reserved subdomain');

const editionEnum = z.enum(['masjid', 'laz', 'pesantren', 'yayasan']);

const createSchema = z.object({
  slug: slugSchema,
  name: z.string().min(2).max(200),
  shortName: z.string().max(100).optional(),
  edition: editionEnum.optional(),
  parentTenantId: z.string().uuid().nullable().optional(),
});

const updateSchema = z.object({
  slug: slugSchema.optional(),
  name: z.string().min(2).max(200).optional(),
  shortName: z.string().max(100).nullable().optional(),
  edition: editionEnum.optional(),
  parentTenantId: z.string().uuid().nullable().optional(),
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

    // Auto-provision: seed default chart of accounts + dana sesuai edisi.
    // Idempoten; jika gagal, tenant tetap ada dan bisa di-seed ulang via
    // POST /api/v1/accounts/_seed & /api/v1/funds/_seed.
    let seeded = true;
    try {
      await seedDefaultChart(created.id);
      const fundOpts = fundSeedOptionsForEdition(created.edition);
      if (fundOpts) {
        await withTenant(created.id, async (db) => seedFunds(created.id, fundOpts, db));
      }
    } catch (e) {
      seeded = false;
      logger.error({ err: e, tenantId: created.id }, 'tenant auto-seed failed');
    }

    return c.json({ data: created, seeded }, 201);
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
    if (body.parentTenantId === id) {
      return c.json({ error: 'invalid_parent', detail: 'tenant cannot be its own parent' }, 400);
    }
    let slugTaken = false;
    const updated = await asSuperAdmin(async (tx) => {
      if (body.slug) {
        const taken = await tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(and(eq(tenants.slug, body.slug), isNull(tenants.deletedAt)));
        if (taken[0] && taken[0].id !== id) {
          slugTaken = true;
          return null;
        }
      }
      const [r] = await tx
        .update(tenants)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(tenants.id, id), isNull(tenants.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (slugTaken) return c.json({ error: 'slug_taken', slug: body.slug }, 409);
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: updated });
  });
