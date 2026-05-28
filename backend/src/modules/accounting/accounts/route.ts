/**
 * Accounts route — Chart of Accounts CRUD.
 *
 *   GET    /api/v1/accounts                  list (active, hierarchical)
 *   POST   /api/v1/accounts                  create
 *   GET    /api/v1/accounts/:id              detail
 *   PATCH  /api/v1/accounts/:id              update
 *   DELETE /api/v1/accounts/:id              soft-delete (block if isSystem)
 *   POST   /api/v1/accounts/_seed            re-run PSAK 45 seed (idempotent)
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { accounts } from '../../../db/schema/accounting.js';
import { auditInterceptor } from '../../../lib/audit.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import {
  requirePermission,
  type PermissionVars,
} from '../../../middleware/permission.js';
import { seedDefaultChart } from './service.js';

const accountTypeEnum = z.enum([
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
  'contra_asset',
  'contra_liability',
]);
const normalBalanceEnum = z.enum(['debit', 'credit']);

const createSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  code: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9._-]+$/, 'invalid characters'),
  name: z.string().min(1).max(200),
  accountType: accountTypeEnum,
  normalBalance: normalBalanceEnum,
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = createSchema.partial().omit({ code: true });

export const accountsRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/', requirePermission('accounts.read'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const rows = await withTenant(tenantId, async (tx) =>
      tx
        .select()
        .from(accounts)
        .where(isNull(accounts.deletedAt))
        .orderBy(accounts.code),
    );
    return c.json({ data: rows });
  })

  .post('/', requirePermission('accounts.manage'), zValidator('json', createSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const body = c.req.valid('json');
    const created = await withTenant(tenantId, async (tx) => {
      const dup = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.tenantId, tenantId),
            eq(accounts.code, body.code),
            isNull(accounts.deletedAt),
          ),
        );
      if (dup[0]) return null;
      const [r] = await tx.insert(accounts).values({ tenantId, ...body }).returning();
      return r!;
    });
    if (!created) return c.json({ error: 'code_taken', code: body.code }, 409);
    return c.json({ data: created }, 201);
  })

  .get('/:id', requirePermission('accounts.read'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const row = await withTenant(tenantId, async (tx) => {
      const r = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)));
      return r[0] ?? null;
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: row });
  })

  .patch('/:id', requirePermission('accounts.manage'), zValidator('json', updateSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const updated = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(accounts)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
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
        .from(accounts)
        .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)));
      if (!r) return { ok: false, reason: 'not_found' as const };
      if (r.isSystem) return { ok: false, reason: 'system_account' as const };
      await tx
        .update(accounts)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(eq(accounts.id, id));
      return { ok: true as const };
    });
    if (!removed.ok) {
      const status = removed.reason === 'not_found' ? 404 : 409;
      return c.json({ error: removed.reason }, status);
    }
    return c.body(null, 204);
  })

  .post('/_seed', requirePermission('accounts.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const inserted = await seedDefaultChart(tenantId);
    return c.json({ inserted });
  });
