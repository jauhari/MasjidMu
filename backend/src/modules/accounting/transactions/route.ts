/**
 * Transactions route — multi-line double-entry.
 *
 *   GET    /api/v1/transactions           list (filterable)
 *   POST   /api/v1/transactions           create with lines (status=draft)
 *   GET    /api/v1/transactions/:id       detail with lines
 *   PATCH  /api/v1/transactions/:id       update header + lines (only when draft)
 *   DELETE /api/v1/transactions/:id       soft-delete (only when draft)
 *   POST   /api/v1/transactions/:id/submit       draft → submitted
 *   POST   /api/v1/transactions/:id/approve      submitted → approved
 *   POST   /api/v1/transactions/:id/reject       submitted → rejected
 *   POST   /api/v1/transactions/:id/recall       submitted → draft
 *   POST   /api/v1/transactions/:id/reset        rejected → draft
 *   POST   /api/v1/transactions/:id/post         approved → posted (+ journal)
 *
 *   PATCH  /api/v1/transactions/:id/force-edit   GOD MODE: bypass state machine
 *   DELETE /api/v1/transactions/:id/force-delete GOD MODE: nuke + audit
 *
 * GOD MODE requires permission `transactions.god_mode` (super_admin only).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { transactionLines, transactions } from '../../../db/schema/accounting.js';
import { auditInterceptor } from '../../../lib/audit.js';
import { findTenantUser } from '../../../lib/user-mapping.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import {
  requirePermission,
  type PermissionVars,
} from '../../../middleware/permission.js';
import {
  InvalidLinesError,
  JournalAlreadyPostedError,
  TransactionNotFoundError,
  UnbalancedLinesError,
  forceDeleteTransaction,
  forceEditTransaction,
  postTransaction,
  replaceLines,
  totalFromLines,
  transitionStatus,
  validateLines,
} from './service.js';
import { IllegalTransitionError } from './state-machine.js';

const lineSchema = z.object({
  accountId: z.string().uuid(),
  debit: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), 'debit must be numeric'),
  credit: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), 'credit must be numeric'),
  description: z.string().max(500).nullable().optional(),
});

const createSchema = z.object({
  transactionDate: z.coerce.date(),
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).optional(),
  referenceNo: z.string().max(100).optional(),
  lines: z.array(lineSchema).min(2),
});

const updateSchema = z.object({
  transactionDate: z.coerce.date().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  referenceNo: z.string().max(100).nullable().optional(),
  lines: z.array(lineSchema).min(2).optional(),
});

const forceEditSchema = z.object({
  reason: z.string().min(10).max(2000),
  transactionDate: z.coerce.date().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  referenceNo: z.string().max(100).nullable().optional(),
  lines: z.array(lineSchema).min(2),
});

const forceDeleteSchema = z.object({
  reason: z.string().min(10).max(2000),
});

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
  if (e instanceof UnbalancedLinesError) return { status: 422, body: { error: 'unbalanced', detail: `D=${e.debit} C=${e.credit}` } };
  if (e instanceof InvalidLinesError) return { status: 422, body: { error: 'invalid_lines', detail: e.message } };
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
      return tx
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

    try {
      await validateLines(tenantId, body.lines);
    } catch (e) {
      const m = mapErrorToResponse(e);
      return c.json(m.body, m.status);
    }

    const transactionNo = await generateTransactionNo(tenantId, tenant.slug, body.transactionDate);
    const totalAmount = totalFromLines(body.lines);

    const created = await withTenant(tenantId, async (tx) => {
      const [t] = await tx
        .insert(transactions)
        .values({
          tenantId,
          transactionNo,
          transactionDate: body.transactionDate,
          categoryId: body.categoryId ?? null,
          amount: totalAmount,
          description: body.description,
          referenceNo: body.referenceNo,
          status: 'draft',
          createdBy: u.id,
        })
        .returning();
      await tx.insert(transactionLines).values(
        body.lines.map((l, i) => ({
          transactionId: t!.id,
          accountId: l.accountId,
          debit: l.debit || '0',
          credit: l.credit || '0',
          description: l.description ?? null,
          sortOrder: i,
        })),
      );
      return t!;
    });
    return c.json({ data: created }, 201);
  })

  .get('/:id', requirePermission('transactions.read'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const result = await withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)));
      if (!row) return null;
      const lines = await tx
        .select()
        .from(transactionLines)
        .where(eq(transactionLines.transactionId, id))
        .orderBy(transactionLines.sortOrder);
      return { ...row, lines };
    });
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: result });
  })

  .patch(
    '/:id',
    requirePermission('transactions.create'),
    zValidator('json', updateSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');

      try {
        const result = await withTenant(tenantId, async (tx) => {
          const [current] = await tx
            .select()
            .from(transactions)
            .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)));
          if (!current) return { ok: false as const, reason: 'not_found' as const };
          if (current.status !== 'draft') {
            return { ok: false as const, reason: 'not_draft' as const };
          }

          const headerPatch: Record<string, unknown> = { updatedAt: new Date() };
          if (body.transactionDate) headerPatch.transactionDate = body.transactionDate;
          if (body.categoryId !== undefined) headerPatch.categoryId = body.categoryId;
          if (body.description !== undefined) headerPatch.description = body.description;
          if (body.referenceNo !== undefined) headerPatch.referenceNo = body.referenceNo;
          if (body.lines) headerPatch.amount = totalFromLines(body.lines);

          const [r] = await tx
            .update(transactions)
            .set(headerPatch)
            .where(eq(transactions.id, id))
            .returning();
          return { ok: true as const, row: r! };
        });

        if (!result.ok) {
          return c.json(
            { error: result.reason },
            result.reason === 'not_found' ? 404 : 409,
          );
        }

        if (body.lines) {
          await replaceLines(tenantId, id, body.lines);
        }

        return c.json({ data: result.row });
      } catch (e) {
        const m = mapErrorToResponse(e);
        return c.json(m.body, m.status);
      }
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

  .post('/:id/recall', requirePermission('transactions.submit'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const authUser = c.get('user')!;
    const id = c.req.param('id');
    try {
      const r = await transitionStatus(tenantId, id, 'draft', authUser.id);
      return c.json({ data: r });
    } catch (e) {
      const m = mapErrorToResponse(e);
      return c.json(m.body, m.status);
    }
  })

  .post('/:id/reset', requirePermission('transactions.create'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const authUser = c.get('user')!;
    const id = c.req.param('id');
    try {
      const r = await transitionStatus(tenantId, id, 'draft', authUser.id);
      return c.json({ data: r });
    } catch (e) {
      const m = mapErrorToResponse(e);
      return c.json(m.body, m.status);
    }
  })

  .delete('/:id', requirePermission('transactions.create'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const result = await withTenant(tenantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)));
      if (!current) return { ok: false as const, reason: 'not_found' as const };
      if (current.status !== 'draft') {
        return { ok: false as const, reason: 'not_draft' as const };
      }
      await tx
        .update(transactions)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(transactions.id, id));
      return { ok: true as const };
    });
    if (!result.ok) {
      return c.json({ error: result.reason }, result.reason === 'not_found' ? 404 : 409);
    }
    return c.body(null, 204);
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
  })

  .patch(
    '/:id/force-edit',
    requirePermission('transactions.god_mode'),
    zValidator('json', forceEditSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const authUser = c.get('user')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');

      const u = await findTenantUser(authUser.id, tenantId);
      if (!u) return c.json({ error: 'tenant_user_missing' }, 422);

      try {
        const r = await forceEditTransaction({
          tenantId,
          transactionId: id,
          appUserId: u.id,
          reason: body.reason,
          header: {
            transactionDate: body.transactionDate,
            description: body.description,
            referenceNo: body.referenceNo,
            categoryId: body.categoryId,
          },
          lines: body.lines,
        });
        return c.json({ data: r });
      } catch (e) {
        const m = mapErrorToResponse(e);
        return c.json(m.body, m.status);
      }
    },
  )

  .delete(
    '/:id/force-delete',
    requirePermission('transactions.god_mode'),
    zValidator('json', forceDeleteSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const authUser = c.get('user')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');

      const u = await findTenantUser(authUser.id, tenantId);
      if (!u) return c.json({ error: 'tenant_user_missing' }, 422);

      try {
        await forceDeleteTransaction({
          tenantId,
          transactionId: id,
          appUserId: u.id,
          reason: body.reason,
        });
        return c.body(null, 204);
      } catch (e) {
        const m = mapErrorToResponse(e);
        return c.json(m.body, m.status);
      }
    },
  );
