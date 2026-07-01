/**
 * Funds route — daftar, CRUD, & seeding Dana (PSAK 109 / PSAK 112).
 *
 *   GET    /api/v1/funds              list dana aktif (untuk selektor & laporan)
 *   POST   /api/v1/funds              buat dana kustom (mis. "Program Ambulans")
 *   PATCH  /api/v1/funds/:id          ubah nama/status/restricted
 *   DELETE /api/v1/funds/:id          arsipkan (soft-delete; blok bila isSystem)
 *   POST   /api/v1/funds/_seed        seed dana default (idempoten)
 *
 * Dana kustom (program/kampanye) dibuat sebagai baris tambahan di bawah
 * fundType yang sudah ada (biasanya 'infaq_sedekah', isRestricted=true) —
 * bukan fundType baru. Ini yang membuat program seperti "Program Ambulans"
 * otomatis muncul di laporan Sumber & Penggunaan Dana tanpa perubahan skema.
 *
 * Reuse permission akuntansi (`accounts.read` / `accounts.manage`) — funds
 * adalah bagian dari setup akuntansi, jadi tidak perlu permission terpisah.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { funds, fundTypeEnum } from '../../../db/schema/accounting.js';
import { auditInterceptor } from '../../../lib/audit.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { seedFunds } from './service.js';

const seedSchema = z.object({
  withZakat: z.boolean().optional(),
  withWakaf: z.boolean().optional(),
});

const fundTypeSchema = z.enum(fundTypeEnum.enumValues);

const createSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9._-]+$/, 'invalid characters'),
  name: z.string().min(1).max(200),
  fundType: fundTypeSchema,
  isRestricted: z.boolean().optional(),
  description: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const updateSchema = createSchema.partial().omit({ code: true }).extend({
  isActive: z.boolean().optional(),
});

export const fundsRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/', requirePermission('accounts.read'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const rows = await withTenant(tenantId, async (tx) =>
      tx
        .select({
          id: funds.id,
          code: funds.code,
          name: funds.name,
          fundType: funds.fundType,
          isRestricted: funds.isRestricted,
          description: funds.description,
          isActive: funds.isActive,
          isSystem: funds.isSystem,
          sortOrder: funds.sortOrder,
        })
        .from(funds)
        .where(and(eq(funds.tenantId, tenantId), isNull(funds.deletedAt)))
        .orderBy(asc(funds.sortOrder), asc(funds.code)),
    );
    return c.json({ data: rows });
  })

  .post('/', requirePermission('accounts.manage'), zValidator('json', createSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const body = c.req.valid('json');
    const created = await withTenant(tenantId, async (tx) => {
      const dup = await tx
        .select({ id: funds.id })
        .from(funds)
        .where(and(eq(funds.tenantId, tenantId), eq(funds.code, body.code), isNull(funds.deletedAt)));
      if (dup[0]) return null;
      const [r] = await tx
        .insert(funds)
        .values({
          tenantId,
          code: body.code,
          name: body.name,
          fundType: body.fundType,
          isRestricted: body.isRestricted ?? false,
          description: body.description ?? null,
          sortOrder: body.sortOrder ?? 0,
        })
        .returning();
      return r!;
    });
    if (!created) return c.json({ error: 'code_taken', code: body.code }, 409);
    return c.json({ data: created }, 201);
  })

  .patch('/:id', requirePermission('accounts.manage'), zValidator('json', updateSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const updated = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(funds)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(funds.id, id), eq(funds.tenantId, tenantId), isNull(funds.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: updated });
  })

  .delete('/:id', requirePermission('accounts.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const removed = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(funds)
        .where(and(eq(funds.id, id), eq(funds.tenantId, tenantId), isNull(funds.deletedAt)));
      if (!r) return { ok: false, reason: 'not_found' as const };
      if (r.isSystem) return { ok: false, reason: 'system_fund' as const };
      await tx
        .update(funds)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(eq(funds.id, id));
      return { ok: true as const };
    });
    if (!removed.ok) {
      const status = removed.reason === 'not_found' ? 404 : 409;
      return c.json({ error: removed.reason }, status);
    }
    return c.body(null, 204);
  })

  .post('/_seed', requirePermission('accounts.manage'), zValidator('json', seedSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const opts = c.req.valid('json');
    const inserted = await withTenant(tenantId, async (db) => seedFunds(tenantId, opts, db));
    return c.json({ inserted });
  });
