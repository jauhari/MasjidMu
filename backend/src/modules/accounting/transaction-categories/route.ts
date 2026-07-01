/**
 * Transaction categories — links a user-friendly category (e.g. "Infaq Jumat",
 * "Beban Listrik") to a debit/credit COA pair plus direction (income/expense).
 *
 * When a transaction is posted, the journal lines are auto-generated using
 * this category's debit_account_id and credit_account_id.
 *
 * Both accounts must belong to the same tenant (enforced via RLS — anything
 * else returns 0 rows and triggers FK violation).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { accounts, transactionCategories } from '../../../db/schema/accounting.js';
import { auditInterceptor } from '../../../lib/audit.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import {
  requirePermission,
  type PermissionVars,
} from '../../../middleware/permission.js';

const directionEnum = z.enum(['income', 'expense']);

/**
 * Direction-based requirement (sesuai PSAK 45 / akuntansi standar):
 *   - Pemasukan : credit_account = WAJIB (akun pendapatan), debit opsional
 *   - Pengeluaran: debit_account  = WAJIB (akun beban),     credit opsional
 *
 * Mirror dari CHECK constraint di DB (070_transaction_categories_optional_accounts.sql)
 * supaya error muncul sebagai validation failure (400) bukan FK violation (500).
 */
function refineDirectionAccounts<T extends z.ZodTypeAny>(schema: T): T {
  return schema.superRefine((val, ctx) => {
    const v = val as {
      direction?: 'income' | 'expense';
      debitAccountId?: string | null;
      creditAccountId?: string | null;
    };
    if (v.direction === 'income' && !v.creditAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['creditAccountId'],
        message: 'Akun kredit wajib untuk kategori pemasukan',
      });
    }
    if (v.direction === 'expense' && !v.debitAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['debitAccountId'],
        message: 'Akun debit wajib untuk kategori pengeluaran',
      });
    }
  }) as unknown as T;
}

const createSchema = refineDirectionAccounts(
  z.object({
    code: z.string().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/, 'invalid characters'),
    name: z.string().min(1).max(200),
    direction: directionEnum,
    debitAccountId: z.string().uuid().nullable().optional(),
    creditAccountId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  }),
);

const updateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    direction: directionEnum.optional(),
    debitAccountId: z.string().uuid().nullable().optional(),
    creditAccountId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  });

async function assertAccountsExist(
  tenantId: string,
  debitId: string | null | undefined,
  creditId: string | null | undefined,
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  if (!debitId && !creditId) return { ok: true };
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, tenantId),
          isNull(accounts.deletedAt),
          eq(accounts.isActive, true),
        ),
      );
    const ids = new Set(rows.map((r) => r.id));
    const missing: string[] = [];
    if (debitId && !ids.has(debitId)) missing.push('debit');
    if (creditId && !ids.has(creditId)) missing.push('credit');
    return missing.length === 0 ? { ok: true as const } : { ok: false as const, missing };
  });
}

export const transactionCategoriesRoute = new Hono<{
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
        .from(transactionCategories)
        .where(isNull(transactionCategories.deletedAt))
        .orderBy(transactionCategories.code),
    );
    return c.json({ data: rows });
  })

  .post('/', requirePermission('accounts.manage'), zValidator('json', createSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const body = c.req.valid('json');

    const accountCheck = await assertAccountsExist(
      tenantId,
      body.debitAccountId,
      body.creditAccountId,
    );
    if (!accountCheck.ok) {
      return c.json({ error: 'invalid_accounts', missing: accountCheck.missing }, 422);
    }

    const created = await withTenant(tenantId, async (tx) => {
      const dup = await tx
        .select({ id: transactionCategories.id })
        .from(transactionCategories)
        .where(
          and(
            eq(transactionCategories.tenantId, tenantId),
            eq(transactionCategories.code, body.code),
            isNull(transactionCategories.deletedAt),
          ),
        );
      if (dup[0]) return null;
      const [r] = await tx
        .insert(transactionCategories)
        .values({ tenantId, ...body })
        .returning();
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
        .from(transactionCategories)
        .where(and(eq(transactionCategories.id, id), isNull(transactionCategories.deletedAt)));
      return r[0] ?? null;
    });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: row });
  })

  .patch(
    '/:id',
    requirePermission('accounts.manage'),
    zValidator('json', updateSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');

      // Fetch current row to compute merged state for direction-rule check.
      const current = await withTenant(tenantId, async (tx) => {
        const r = await tx
          .select()
          .from(transactionCategories)
          .where(
            and(eq(transactionCategories.id, id), isNull(transactionCategories.deletedAt)),
          );
        return r[0] ?? null;
      });
      if (!current) return c.json({ error: 'not_found' }, 404);

      const merged = {
        direction: body.direction ?? current.direction,
        debitAccountId:
          body.debitAccountId !== undefined ? body.debitAccountId : current.debitAccountId,
        creditAccountId:
          body.creditAccountId !== undefined ? body.creditAccountId : current.creditAccountId,
      };

      if (merged.direction === 'income' && !merged.creditAccountId) {
        return c.json({ error: 'credit_required_for_income', missing: ['credit'] }, 422);
      }
      if (merged.direction === 'expense' && !merged.debitAccountId) {
        return c.json({ error: 'debit_required_for_expense', missing: ['debit'] }, 422);
      }

      if (body.debitAccountId || body.creditAccountId) {
        const accountCheck = await assertAccountsExist(
          tenantId,
          body.debitAccountId,
          body.creditAccountId,
        );
        if (!accountCheck.ok) {
          return c.json({ error: 'invalid_accounts', missing: accountCheck.missing }, 422);
        }
      }

      const updated = await withTenant(tenantId, async (tx) => {
        const [r] = await tx
          .update(transactionCategories)
          .set({ ...body, updatedAt: new Date() })
          .where(
            and(eq(transactionCategories.id, id), isNull(transactionCategories.deletedAt)),
          )
          .returning();
        return r ?? null;
      });
      if (!updated) return c.json({ error: 'not_found' }, 404);
      return c.json({ data: updated });
    },
  )

  .delete('/:id', requirePermission('accounts.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const removed = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(transactionCategories)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(
          and(eq(transactionCategories.id, id), isNull(transactionCategories.deletedAt)),
        )
        .returning();
      return r ?? null;
    });
    if (!removed) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });
