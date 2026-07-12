/**
 * Accounts route — Chart of Accounts CRUD.
 *
 *   GET    /api/v1/accounts                  list (active, hierarchical, with balance)
 *   POST   /api/v1/accounts                  create
 *   GET    /api/v1/accounts/:id              detail
 *   PATCH  /api/v1/accounts/:id              update
 *   DELETE /api/v1/accounts/:id              soft-delete (block if isSystem)
 *   POST   /api/v1/accounts/_seed            re-run PSAK 45 seed (idempotent)
 *   POST   /api/v1/accounts/:id/merge        merge source → target, soft-delete source
 *
 * The list endpoint includes a `balance` field per account, computed from
 * journal_lines (own movements only — caller can sum descendants for header
 * balances). Sign follows normal_balance: debit-normal accounts return
 * SUM(debit) - SUM(credit); credit-normal return the opposite.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import {
  accounts,
  journalLines,
  transactionLines,
  transactionCategories,
} from '../../../db/schema/accounting.js';
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

/** Empty string from FE selects → null; never reject "" as invalid UUID. */
const optionalUuid = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.string().uuid().nullable(),
);

const createSchema = z.object({
  parentId: optionalUuid.optional(),
  code: z
    .string()
    .trim()
    .min(1, 'Kode akun wajib diisi')
    .max(20)
    .regex(/^[A-Za-z0-9._-]+$/, 'Kode hanya boleh huruf, angka, titik, _ atau -'),
  name: z.string().trim().min(1, 'Nama akun wajib diisi').max(200),
  accountType: accountTypeEnum,
  normalBalance: normalBalanceEnum,
  description: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.string().max(2000).nullable(),
  ).optional(),
  isActive: z.boolean().optional(),
  openingBalance: z.preprocess(
    (v) => {
      if (v === '' || v === undefined || v === null) return '0';
      // Terima "1.000,50" (ID) → "1000.50" kasar: buang pemisah ribuan titik
      const s = String(v).trim().replace(/\s/g, '');
      if (/^\d+([.,]\d{1,2})?$/.test(s)) return s.replace(',', '.');
      if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
        return s.replace(/\./g, '').replace(',', '.');
      }
      return s;
    },
    z.string().regex(/^\d+(\.\d{1,2})?$/, 'Saldo awal harus angka'),
  ).optional(),
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
    const lite = c.req.query('lite') === '1';

    if (lite) {
      const rows = await withTenant(tenantId, async (tx) =>
        tx
          .select({
            id: accounts.id,
            parentId: accounts.parentId,
            code: accounts.code,
            name: accounts.name,
            accountType: accounts.accountType,
            isActive: accounts.isActive,
          })
          .from(accounts)
          .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)))
          .orderBy(accounts.code),
      );
      return c.json({ data: rows });
    }

    const rows = await withTenant(tenantId, async (tx) => {
      // Self-balance per account from journal_lines, signed by normal_balance.
      // LEFT JOIN so accounts with no journal lines still appear with balance=0.
      const r = await tx.execute(sql`
        SELECT
          a.id, a.tenant_id, a.parent_id, a.code, a.name,
          a.account_type, a.normal_balance, a.description,
          a.is_active, a.is_system,           a.opening_balance,
          a.created_at, a.updated_at, a.deleted_at,
          COALESCE(
            CASE
              WHEN a.normal_balance = 'debit'
                THEN SUM(jl.debit) - SUM(jl.credit)
              ELSE SUM(jl.credit) - SUM(jl.debit)
            END,
            0
          )::text AS balance
        FROM accounts a
        LEFT JOIN journal_lines jl ON jl.account_id = a.id
        WHERE a.tenant_id = ${tenantId}
          AND a.deleted_at IS NULL
        GROUP BY a.id
        ORDER BY a.code
      `);
      // Drizzle returns snake_case from raw SQL; map to camelCase for the API.
      return (r.rows as Array<Record<string, unknown>>).map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        parentId: row.parent_id,
        code: row.code,
        name: row.name,
        accountType: row.account_type,
        normalBalance: row.normal_balance,
        description: row.description,
        isActive: row.is_active,
        isSystem: row.is_system,
        openingBalance: row.opening_balance,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
        balance: row.balance,
      }));
    });
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

  .post(
    '/:id/merge',
    requirePermission('accounts.manage'),
    zValidator('json', z.object({ targetId: z.string().uuid() })),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const sourceId = c.req.param('id');
      const { targetId } = c.req.valid('json');

      if (sourceId === targetId) {
        return c.json({ error: 'same_account' }, 400);
      }

      const result = await withTenant(tenantId, async (tx) => {
        const [source, target] = await Promise.all([
          tx
            .select()
            .from(accounts)
            .where(and(eq(accounts.id, sourceId), eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)))
            .then((r) => r[0] ?? null),
          tx
            .select()
            .from(accounts)
            .where(and(eq(accounts.id, targetId), eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)))
            .then((r) => r[0] ?? null),
        ]);

        if (!source) return { ok: false, reason: 'source_not_found' as const };
        if (!target) return { ok: false, reason: 'target_not_found' as const };
        if (source.isSystem) return { ok: false, reason: 'source_is_system' as const };

        // Re-assign journal_lines
        const jlRes = await tx
          .update(journalLines)
          .set({ accountId: targetId })
          .where(eq(journalLines.accountId, sourceId))
          .returning({ id: journalLines.id });

        // Re-assign transaction_lines
        const tlRes = await tx
          .update(transactionLines)
          .set({ accountId: targetId })
          .where(eq(transactionLines.accountId, sourceId))
          .returning({ id: transactionLines.id });

        // Re-assign category debit/credit references
        await tx
          .update(transactionCategories)
          .set({ debitAccountId: targetId })
          .where(eq(transactionCategories.debitAccountId, sourceId));
        await tx
          .update(transactionCategories)
          .set({ creditAccountId: targetId })
          .where(eq(transactionCategories.creditAccountId, sourceId));

        // Reparent any children of source to target
        await tx
          .update(accounts)
          .set({ parentId: targetId, updatedAt: new Date() })
          .where(and(eq(accounts.parentId, sourceId), isNull(accounts.deletedAt)));

        // Soft-delete source
        await tx
          .update(accounts)
          .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
          .where(eq(accounts.id, sourceId));

        return {
          ok: true as const,
          journalLinesReassigned: jlRes.length,
          transactionLinesReassigned: tlRes.length,
          target,
        };
      });

      if (!result.ok) {
        const status =
          result.reason === 'source_not_found' || result.reason === 'target_not_found' ? 404 : 409;
        return c.json({ error: result.reason }, status);
      }

      return c.json({
        journalLinesReassigned: result.journalLinesReassigned,
        transactionLinesReassigned: result.transactionLinesReassigned,
        target: result.target,
      });
    },
  )

  .post('/_seed', requirePermission('accounts.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const inserted = await seedDefaultChart(tenantId);
    return c.json({ inserted });
  });
