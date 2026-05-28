/**
 * Transactions route.
 *
 *   GET    /api/v1/transactions           list (filterable)
 *   POST   /api/v1/transactions           create (status=draft)
 *   GET    /api/v1/transactions/:id       detail
 *   PATCH  /api/v1/transactions/:id       update (only when draft)
 *   POST   /api/v1/transactions/:id/submit       draft → submitted
 *   POST   /api/v1/transactions/:id/approve      submitted → approved
 *   POST   /api/v1/transactions/:id/reject       submitted → rejected
 *   POST   /api/v1/transactions/:id/post         approved → posted (+ journal)
 *
 * State changes happen through the service layer to keep transitions, audit
 * logging, and journal generation consistent.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { transactions } from '../../../db/schema/accounting.js';
import { auditInterceptor } from '../../../lib/audit.js';
import { findTenantUser } from '../../../lib/user-mapping.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import {
  requirePermission,
  type PermissionVars,
} from '../../../middleware/permission.js';
import {
  CategoryNotFoundError,
  JournalAlreadyPostedError,
  TransactionNotFoundError,
  postTransaction,
  transitionStatus,
} from './service.js';
import { IllegalTransitionError } from './state-machine.js';

const createSchema = z.object({
  transactionDate: z.coerce.date(),
  categoryId: z.string().uuid(),
  amount: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((s) => /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0, 'amount must be positive numeric'),
  description: z.string().max(2000).optional(),
  referenceNo: z.string().max(100).optional(),
});

const updateSchema = createSchema.partial();

async function generateTransactionNo(tenantId: string, tenantSlug: string, date: Date): Promise<string> {
  const yyyymm = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return withTenant(tenantId, async (tx) => {
    const r = await tx
      .select({ n: count() })
      .from(transactions)
      .where(eq(transactions.tenantId, tenantId));
    const seq = String(((r[0]?.n ?? 0) % 9999) + 1).padStart(4, '0');
    const tenantPrefix = tenantSlug.slice(0, 4).toUpperCase().padEnd(4, 'X');
    return `TX-${tenantPrefix}-${yyyymm}-${seq}`;
  });
}

function mapErrorToResponse(e: unknown): { status: 400 | 404 | 409 | 422; body: { error: string; detail?: string } } {
  if (e instanceof TransactionNotFoundError) return { status: 404, body: { error: 'not_found' } };
  if (e instanceof CategoryNotFoundError) return { status: 422, body: { error: 'category_invalid' } };
  if (e instanceof JournalAlreadyPostedError) return { status: 409, body: { error: 'already_posted' } };
  if (e instanceof IllegalTransitionError) {
    return { status: 409, body: { error: 'illegal_transition', detail: `${e.from} → ${e.to}` } };
  }
  return { status: 400, body: { error: 'invalid', detail: (e as Error).message } };
}

export const transactionsRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/', requirePermission('transactions.read'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const status = c.req.query('status');
    const rows = await withTenant(tenantId, async (tx) => {
      const q = tx
        .select()
        .from(transactions)
        .where(
          and(
            isNull(transactions.deletedAt),
            ...(status ? [eq(transactions.status, status as 'draft' | 'submitted' | 'approved' | 'rejected' | 'posted')] : []),
          ),
        )
        .orderBy(desc(transactions.transactionDate))
        .limit(200);
      return q;
    });
    return c.json({ data: rows });
  })

  .post('/', requirePermission('transactions.create'), zValidator('json', createSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const tenant = c.get('tenant')!;
    const authUser = c.get('user')!;
    const body = c.req.valid('json');

    const u = await findTenantUser(authUser.id, tenantId);
    if (!u) return c.json({ error: 'tenant_user_missing' }, 422);

    const transactionNo = await generateTransactionNo(tenantId, tenant.slug, body.transactionDate);
    const created = await withTenant(tenantId, async (tx) =>
      tx
        .insert(transactions)
        .values({
          tenantId,
          transactionNo,
          transactionDate: body.transactionDate,
          categoryId: body.categoryId,
          amount: body.amount,
          description: body.description,
          referenceNo: body.referenceNo,
          status: 'draft',
          createdBy: u.id,
        })
        .returning(),
    );
    return c.json({ data: created[0] }, 201);
  })

  .get('/:id', requirePermission('transactions.read'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const row = await withTenant(tenantId, async (tx) => {
      const r = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)));
      return r[0] ?? null;
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: row });
  })

  .patch(
    '/:id',
    requirePermission('transactions.create'),
    zValidator('json', updateSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const updated = await withTenant(tenantId, async (tx) => {
        const [current] = await tx
          .select()
          .from(transactions)
          .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)));
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        if (current.status !== 'draft') {
          return { ok: false as const, reason: 'not_draft' as const };
        }
        const [r] = await tx
          .update(transactions)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(transactions.id, id))
          .returning();
        return { ok: true as const, row: r! };
      });
      if (!updated.ok) {
        return c.json(
          { error: updated.reason },
          updated.reason === 'not_found' ? 404 : 409,
        );
      }
      return c.json({ data: updated.row });
    },
  )

  .post('/:id/submit', requirePermission('transactions.submit'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const authUser = c.get('user')!;
    const id = c.req.param('id');
    try {
      const r = await transitionStatus(tenantId, id, 'submitted', authUser.id);
      return c.json({ data: r });
    } catch (e) {
      const m = mapErrorToResponse(e);
      return c.json(m.body, m.status);
    }
  })

  .post('/:id/approve', requirePermission('transactions.approve.stage1'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const authUser = c.get('user')!;
    const id = c.req.param('id');
    try {
      const r = await transitionStatus(tenantId, id, 'approved', authUser.id);
      return c.json({ data: r });
    } catch (e) {
      const m = mapErrorToResponse(e);
      return c.json(m.body, m.status);
    }
  })

  .post('/:id/reject', requirePermission('transactions.reject'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const authUser = c.get('user')!;
    const id = c.req.param('id');
    try {
      const r = await transitionStatus(tenantId, id, 'rejected', authUser.id);
      return c.json({ data: r });
    } catch (e) {
      const m = mapErrorToResponse(e);
      return c.json(m.body, m.status);
    }
  })

  .post('/:id/post', requirePermission('transactions.post'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const tenant = c.get('tenant')!;
    const authUser = c.get('user')!;
    const id = c.req.param('id');

    const u = await findTenantUser(authUser.id, tenantId);
    if (!u) return c.json({ error: 'tenant_user_missing' }, 422);

    try {
      const r = await postTransaction({
        tenantId,
        tenantSlug: tenant.slug,
        transactionId: id,
        appUserId: u.id,
      });
      return c.json({ data: r });
    } catch (e) {
      const m = mapErrorToResponse(e);
      return c.json(m.body, m.status);
    }
  });
