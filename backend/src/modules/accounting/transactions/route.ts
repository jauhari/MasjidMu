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
 *   POST   /api/v1/transactions/:id/express-post Bendahara/GOD: any open → posted
 *   POST   /api/v1/transactions  body.expressPost=true  create + express-post
 *
 *   PATCH  /api/v1/transactions/:id/force-edit   GOD MODE: bypass state machine
 *   DELETE /api/v1/transactions/:id/force-delete GOD MODE: nuke + audit
 *
 * Express path: `transactions.post` OR `transactions.god_mode` OR super_admin.
 * GOD MODE force-* requires `transactions.god_mode` (super_admin only).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, count, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import {
  transactionCategories,
  transactionLines,
  transactions,
} from '../../../db/schema/accounting.js';
import { auditInterceptor } from '../../../lib/audit.js';
import { resolveActingUser } from '../../../lib/user-mapping.js';
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
  expressPostTransaction,
  forceDeleteTransaction,
  forceEditTransaction,
  postTransaction,
  replaceLines,
  totalFromLines,
  transitionStatus,
  validateLines,
} from './service.js';
import { commitImport, matchAccounts, parseImportFile } from './import.js';
import { IllegalTransitionError } from './state-machine.js';
import { allocateAccountingNumber } from './numbering.js';
import { parsePAPExcel, papCommitSchema } from './pap-import.js';
import {
  PAPOCRConfigurationError,
  PAPOCRInputError,
  PAPOCRError,
  PAP_OCR_ALLOWED_MEDIA_TYPES,
  PAP_OCR_MAX_IMAGES,
  PAP_OCR_MAX_IMAGE_BYTES,
  PAP_OCR_MAX_TOTAL_BYTES,
  parsePAPImages,
} from './pap-ocr.js';
import { commitPAPImport } from './pap-commit.js';

function canCommitPAP(c: { get: (k: string) => unknown }): boolean {
  if (c.get('isSuperAdmin')) return true;
  const permissions = c.get('permissions') as Set<string> | undefined;
  return !!permissions?.has('transactions.create') && !!permissions.has('transactions.post');
}

function canExpressPost(c: {
  get: (k: string) => unknown;
}): boolean {
  if (c.get('isSuperAdmin')) return true;
  const perms = c.get('permissions') as Set<string> | undefined;
  if (!perms) return false;
  return perms.has('transactions.post') || perms.has('transactions.god_mode');
}

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
  fundId: z.string().uuid().nullable().optional(),
});

const createSchema = z.object({
  transactionDate: z.coerce.date(),
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).optional(),
  referenceNo: z.string().max(100).optional(),
  lines: z.array(lineSchema).min(2),
  /** Jalur cepat Bendahara/GOD: create + posting dalam satu request */
  expressPost: z.boolean().optional(),
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

const importCommitSchema = z.object({
  reason: z.string().min(10).max(2000),
  groups: z.array(
    z.object({
      date: z.string(),
      description: z.string().min(1).max(2000),
      referenceNo: z.string().max(100).nullable().optional(),
      lines: z.array(lineSchema).min(2),
    }),
  ).min(1),
});

const importUrlSchema = z.object({
  url: z.string().url(),
  sheet: z.string().min(1).max(100).optional(),
});

/**
 * Extract spreadsheet ID from a Google Sheets URL.
 * Supports common formats:
 *   - https://docs.google.com/spreadsheets/d/{ID}/edit
 *   - https://docs.google.com/spreadsheets/d/{ID}/edit#gid=0
 *   - https://docs.google.com/spreadsheets/d/{ID}/
 */
function extractGoogleSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1]! : null;
}

/**
 * Fetch a Google Sheets workbook as XLSX using the public export endpoint.
 * Sheet must be "Anyone with link can view" or published to web.
 *
 * Returns the raw bytes; parser picks the named tab from the workbook.
 */
async function fetchGoogleSheetXlsx(sheetId: string): Promise<Buffer> {
  const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
  const res = await fetch(exportUrl, {
    redirect: 'follow',
    headers: {
      // Identify ourselves so Google can rate-limit gracefully.
      'User-Agent': 'MasjidMu-Importer/1.0',
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('sheet not public — share as "Anyone with link can view"');
    }
    if (res.status === 404) {
      throw new Error('sheet not found — check the URL');
    }
    throw new Error(`google_export_failed_${res.status}`);
  }

  // Google sometimes returns text/html (a sign-in page) instead of xlsx
  // when the sheet isn't actually public. Detect by content-type.
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('spreadsheet') && !ct.includes('octet-stream') && !ct.includes('zip')) {
    throw new Error('sheet not public — got HTML response (likely sign-in page)');
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
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

  .post('/_import/pap/parse-excel', requirePermission('transactions.create'), async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400);
    if (file.size > 20 * 1024 * 1024) return c.json({ error: 'file_too_large' }, 413);
    try {
      const result = await parsePAPExcel(new Uint8Array(await file.arrayBuffer()),
        typeof body.sheet === 'string' ? body.sheet : undefined);
      return c.json({ data: result });
    } catch (error) {
      return c.json({ error: 'pap_excel_invalid', detail: (error as Error).message }, 422);
    }
  })

  .post('/_import/pap/parse-images', requirePermission('transactions.create'), async (c) => {
    const form = await c.req.formData();
    const files = form.getAll('files').filter((value): value is File => value instanceof File);
    const rotations = form.getAll('rotations');
    if (files.length === 0 || files.length > PAP_OCR_MAX_IMAGES) {
      return c.json({ error: 'invalid_image_count', max: PAP_OCR_MAX_IMAGES }, 400);
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > PAP_OCR_MAX_TOTAL_BYTES) {
      return c.json({ error: 'images_too_large', max: PAP_OCR_MAX_TOTAL_BYTES }, 413);
    }
    const parsedRotations = rotations.length === 0
      ? files.map(() => 0 as const)
      : rotations.map((rotation) => Number(rotation));
    if (
      parsedRotations.length !== files.length
      || parsedRotations.some((rotation) => ![0, 90, 180, 270].includes(rotation))
    ) {
      return c.json({ error: 'invalid_image_rotation' }, 400);
    }
    try {
      const images = await Promise.all(files.map(async (file, index) => {
        if (!PAP_OCR_ALLOWED_MEDIA_TYPES.includes(file.type as never)) {
          throw new PAPOCRInputError(`tipe gambar tidak didukung: ${file.type}`);
        }
        if (file.size > PAP_OCR_MAX_IMAGE_BYTES) throw new PAPOCRInputError('gambar terlalu besar');
        return {
          bytes: new Uint8Array(await file.arrayBuffer()),
          mediaType: file.type as (typeof PAP_OCR_ALLOWED_MEDIA_TYPES)[number],
          name: file.name,
          rotationDegrees: parsedRotations[index] as 0 | 90 | 180 | 270,
        };
      }));
      return c.json({ data: await parsePAPImages(images) });
    } catch (error) {
      if (error instanceof PAPOCRInputError) {
        return c.json({ error: 'pap_ocr_invalid', detail: error.message }, 400);
      }
      if (error instanceof PAPOCRConfigurationError) {
        return c.json({ error: 'ocr_not_configured', detail: error.message }, 503);
      }
      if (error instanceof PAPOCRError) {
        return c.json({ error: 'pap_ocr_failed', detail: error.message }, 502);
      }
      return c.json({ error: 'pap_ocr_failed', detail: (error as Error).message }, 500);
    }
  })

  .post('/_import/pap/commit', zValidator('json', papCommitSchema), async (c) => {
    if (!canCommitPAP(c)) return c.json({ error: 'forbidden', required: 'transactions.create+transactions.post' }, 403);
    const tenantId = c.get('tenantId')!;
    const tenant = c.get('tenant')!;
    const user = await resolveActingUser(c.get('user')!, tenantId, !!c.get('isSuperAdmin'));
    if (!user) return c.json({ error: 'tenant_user_missing' }, 422);
    try {
      const result = await commitPAPImport({
        tenantId,
        tenantSlug: tenant.slug,
        appUserId: user.id,
        input: c.req.valid('json'),
      });
      if (!result.duplicate) {
        const { refreshReportsAfterPosting } = await import('../../../lib/cron/refresh-mat-views.js');
        await refreshReportsAfterPosting();
      }
      return c.json({ data: result }, result.duplicate ? 200 : 201);
    } catch (error) {
      return c.json({ error: 'pap_commit_failed', detail: (error as Error).message }, 422);
    }
  })

  .get('/', requirePermission('transactions.read'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const status = c.req.query('status');
    const q = c.req.query('q')?.trim() || null;
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
    /** Optional server-side direction filter: income | expense */
    const directionFilter = c.req.query('direction')?.trim() || null;

    const filters: (ReturnType<typeof eq> | ReturnType<typeof sql> | ReturnType<typeof or>)[] = [
      isNull(transactions.deletedAt),
    ];
    if (status) {
      filters.push(
        eq(transactions.status, status as 'draft' | 'submitted' | 'approved' | 'rejected' | 'posted'),
      );
    }
    if (q) {
      filters.push(
        or(
          sql`${transactions.transactionNo} ILIKE ${`%${q}%`}`,
          sql`${transactions.description} ILIKE ${`%${q}%`}`,
          sql`${transactions.referenceNo} ILIKE ${`%${q}%`}`,
        ),
      );
    }
    const dateFrom = c.req.query('dateFrom') || null;
    const dateTo = c.req.query('dateTo') || null;
    if (dateFrom) {
      filters.push(gte(transactions.transactionDate, new Date(dateFrom)));
    }
    if (dateTo) {
      // Include full day: add 1 day - 1ms
      const end = new Date(dateTo);
      end.setDate(end.getDate() + 1);
      end.setMilliseconds(end.getMilliseconds() - 1);
      filters.push(lte(transactions.transactionDate, end));
    }
    const accountId = c.req.query('accountId') || null;
    if (accountId) {
      filters.push(
        sql`${transactions.id} IN (
          SELECT tl.transaction_id FROM transaction_lines tl WHERE tl.account_id = ${accountId}::uuid
        )`,
      );
    }

    /**
     * Arah transaksi:
     *  1) dari kategori (income/expense)
     *  2) fallback baris jurnal: kredit akun income → income; debit akun expense → expense
     * Transfer kas murni (tanpa income/expense) → null (tidak masuk KPI pemasukan/pengeluaran).
     */
    const directionSql = sql`CASE
      WHEN ${transactionCategories.direction} IS NOT NULL THEN ${transactionCategories.direction}::text
      WHEN EXISTS (
        SELECT 1
          FROM transaction_lines tl
          JOIN accounts a ON a.id = tl.account_id
         WHERE tl.transaction_id = ${transactions.id}
           AND a.account_type = 'income'
           AND tl.credit::numeric > 0
      ) THEN 'income'
      WHEN EXISTS (
        SELECT 1
          FROM transaction_lines tl
          JOIN accounts a ON a.id = tl.account_id
         WHERE tl.transaction_id = ${transactions.id}
           AND a.account_type = 'expense'
           AND tl.debit::numeric > 0
      ) THEN 'expense'
      ELSE NULL
    END`;

    if (directionFilter === 'income' || directionFilter === 'expense') {
      filters.push(sql`(${directionSql}) = ${directionFilter}`);
    }

    // KPI: hanya status posted (angka keuangan), hormati filter tanggal/q/akun.
    // Filter status list diabaikan agar KPI = yang sudah di jurnal.
    const summaryFilters: typeof filters = [
      isNull(transactions.deletedAt),
      eq(transactions.status, 'posted'),
    ];
    if (q) {
      summaryFilters.push(
        or(
          sql`${transactions.transactionNo} ILIKE ${`%${q}%`}`,
          sql`${transactions.description} ILIKE ${`%${q}%`}`,
          sql`${transactions.referenceNo} ILIKE ${`%${q}%`}`,
        )!,
      );
    }
    if (dateFrom) {
      summaryFilters.push(gte(transactions.transactionDate, new Date(dateFrom)));
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setDate(end.getDate() + 1);
      end.setMilliseconds(end.getMilliseconds() - 1);
      summaryFilters.push(lte(transactions.transactionDate, end));
    }
    if (accountId) {
      summaryFilters.push(
        sql`${transactions.id} IN (
          SELECT tl.transaction_id FROM transaction_lines tl WHERE tl.account_id = ${accountId}::uuid
        )`,
      );
    }

    const [rows, totalRow, summaryRow] = await withTenant(tenantId, async (tx) =>
      Promise.all([
        tx
          .select({
            id: transactions.id,
            tenantId: transactions.tenantId,
            transactionNo: transactions.transactionNo,
            transactionDate: transactions.transactionDate,
            categoryId: transactions.categoryId,
            amount: transactions.amount,
            description: transactions.description,
            referenceNo: transactions.referenceNo,
            status: transactions.status,
            createdBy: transactions.createdBy,
            submittedAt: transactions.submittedAt,
            submittedBy: transactions.submittedBy,
            postedAt: transactions.postedAt,
            postedBy: transactions.postedBy,
            createdAt: transactions.createdAt,
            updatedAt: transactions.updatedAt,
            deletedAt: transactions.deletedAt,
            direction: sql<'income' | 'expense' | null>`${directionSql}`.as('direction'),
          })
          .from(transactions)
          .leftJoin(
            transactionCategories,
            eq(transactionCategories.id, transactions.categoryId),
          )
          .where(and(...filters))
          .orderBy(desc(transactions.transactionDate))
          .limit(limit)
          .offset(offset),
        tx
          .select({ total: count() })
          .from(transactions)
          .leftJoin(
            transactionCategories,
            eq(transactionCategories.id, transactions.categoryId),
          )
          .where(and(...filters)),
        tx
          .select({
            incomeTotal: sql<string>`COALESCE(SUM(CASE WHEN (${directionSql}) = 'income' THEN ${transactions.amount}::numeric ELSE 0 END), 0)::text`,
            expenseTotal: sql<string>`COALESCE(SUM(CASE WHEN (${directionSql}) = 'expense' THEN ${transactions.amount}::numeric ELSE 0 END), 0)::text`,
          })
          .from(transactions)
          .leftJoin(
            transactionCategories,
            eq(transactionCategories.id, transactions.categoryId),
          )
          .where(and(...summaryFilters)),
      ]),
    );

    return c.json({
      data: rows,
      total: totalRow[0]?.total ?? 0,
      offset,
      limit,
      summary: {
        incomeTotal: summaryRow[0]?.incomeTotal ?? '0',
        expenseTotal: summaryRow[0]?.expenseTotal ?? '0',
        /** Hanya posted; filter tanggal/q/akun sama list (status list diabaikan). */
        scope: 'posted' as const,
      },
    });
  })

  .post('/', requirePermission('transactions.create'), zValidator('json', createSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const tenant = c.get('tenant')!;
    const authUser = c.get('user')!;
    const body = c.req.valid('json');

    if (body.expressPost && !canExpressPost(c)) {
      return c.json(
        {
          error: 'forbidden',
          required: 'transactions.post|transactions.god_mode',
          detail: 'Simpan & Posting hanya untuk Bendahara (post) atau GOD mode',
        },
        403,
      );
    }

    const u = await resolveActingUser(authUser, tenantId, !!c.get('isSuperAdmin'));
    if (!u) return c.json({ error: 'tenant_user_missing' }, 422);

    try {
      await validateLines(tenantId, body.lines);
    } catch (e) {
      const m = mapErrorToResponse(e);
      return c.json(m.body, m.status);
    }

    const totalAmount = totalFromLines(body.lines);

    const created = await withTenant(tenantId, async (tx) => {
      const transactionNo = await allocateAccountingNumber({
        tx,
        tenantId,
        tenantSlug: tenant.slug,
        date: body.transactionDate,
        kind: 'transaction',
      });
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
          fundId: l.fundId ?? null,
          debit: l.debit || '0',
          credit: l.credit || '0',
          description: l.description ?? null,
          sortOrder: i,
        })),
      );
      return t!;
    });

    if (body.expressPost) {
      try {
        const posted = await expressPostTransaction({
          tenantId,
          tenantSlug: tenant.slug,
          transactionId: created.id,
          appUserId: u.id,
        });
        const { refreshReportsAfterPosting } = await import(
          '../../../lib/cron/refresh-mat-views.js'
        );
        await refreshReportsAfterPosting();
        return c.json(
          {
            data: {
              ...created,
              status: 'posted' as const,
              journalId: posted.journalId,
              journalNo: posted.journalNo,
            },
          },
          201,
        );
      } catch (e) {
        const m = mapErrorToResponse(e);
        return c.json(
          {
            ...m.body,
            detail:
              (m.body as { detail?: string }).detail ??
              'Draft tersimpan, tetapi posting gagal. Gunakan Posting Cepat di daftar.',
            draftId: created.id,
          },
          m.status,
        );
      }
    }

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

    const u = await resolveActingUser(authUser, tenantId, !!c.get('isSuperAdmin'));
    if (!u) return c.json({ error: 'tenant_user_missing' }, 422);

    try {
      const r = await postTransaction({
        tenantId,
        tenantSlug: tenant.slug,
        transactionId: id,
        appUserId: u.id,
      });
      // Segarkan MV laporan supaya dashboard langsung mencerminkan posting
      const { refreshReportsAfterPosting } = await import('../../../lib/cron/refresh-mat-views.js');
      await refreshReportsAfterPosting();
      return c.json({ data: r });
    } catch (e) {
      const m = mapErrorToResponse(e);
      return c.json(m.body, m.status);
    }
  })

  /**
   * Jalur cepat Bendahara / GOD mode:
   * draft | submitted | approved → posted + jurnal (skip alur ajukan/setujui).
   */
  .post('/:id/express-post', async (c) => {
    if (!canExpressPost(c)) {
      return c.json(
        {
          error: 'forbidden',
          required: 'transactions.post|transactions.god_mode',
          detail: 'Posting cepat hanya untuk Bendahara (post) atau GOD mode',
        },
        403,
      );
    }
    const tenantId = c.get('tenantId')!;
    const tenant = c.get('tenant')!;
    const authUser = c.get('user')!;
    const id = c.req.param('id');

    const u = await resolveActingUser(authUser, tenantId, !!c.get('isSuperAdmin'));
    if (!u) return c.json({ error: 'tenant_user_missing' }, 422);

    try {
      const r = await expressPostTransaction({
        tenantId,
        tenantSlug: tenant.slug,
        transactionId: id,
        appUserId: u.id,
      });
      const { refreshReportsAfterPosting } = await import(
        '../../../lib/cron/refresh-mat-views.js'
      );
      await refreshReportsAfterPosting();
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

      const u = await resolveActingUser(authUser, tenantId, !!c.get('isSuperAdmin'));
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

      const u = await resolveActingUser(authUser, tenantId, !!c.get('isSuperAdmin'));
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
  )

  // ─── Historical journal import (god_mode only) ─────────────────────────────
  .post('/_import/parse', requirePermission('transactions.god_mode'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const form = await c.req.parseBody();
    const file = form['file'];
    const sheetName = (form['sheet'] as string) || 'JURNAL';

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'file_required' }, 400);
    }
    if (file.size > 20 * 1024 * 1024) {
      return c.json({ error: 'file_too_large', detail: 'max 20MB' }, 413);
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await parseImportFile(buffer, sheetName);
      const unmatched = await matchAccounts(tenantId, result.groups);
      return c.json({
        data: {
          totalRows: result.totalRows,
          totalGroups: result.groups.length,
          unmatchedAccountNames: unmatched,
          errors: result.errors,
          groups: result.groups,
        },
      });
    } catch (e) {
      return c.json({ error: 'parse_failed', detail: (e as Error).message }, 400);
    }
  })

  .post(
    '/_import/parse-url',
    requirePermission('transactions.god_mode'),
    zValidator('json', importUrlSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const body = c.req.valid('json');

      const sheetId = extractGoogleSheetId(body.url);
      if (!sheetId) {
        return c.json(
          { error: 'invalid_url', detail: 'expected a Google Sheets URL like https://docs.google.com/spreadsheets/d/{ID}/edit' },
          400,
        );
      }

      let buffer: Buffer;
      try {
        buffer = await fetchGoogleSheetXlsx(sheetId);
      } catch (e) {
        return c.json({ error: 'fetch_failed', detail: (e as Error).message }, 400);
      }

      if (buffer.byteLength > 20 * 1024 * 1024) {
        return c.json({ error: 'file_too_large', detail: 'max 20MB after fetch' }, 413);
      }

      try {
        const sheetName = body.sheet || 'JURNAL';
        const result = await parseImportFile(buffer, sheetName);
        const unmatched = await matchAccounts(tenantId, result.groups);
        return c.json({
          data: {
            totalRows: result.totalRows,
            totalGroups: result.groups.length,
            unmatchedAccountNames: unmatched,
            errors: result.errors,
            groups: result.groups,
            sourceSheetId: sheetId,
          },
        });
      } catch (e) {
        return c.json({ error: 'parse_failed', detail: (e as Error).message }, 400);
      }
    },
  )

  .post(
    '/_import/commit',
    requirePermission('transactions.god_mode'),
    zValidator('json', importCommitSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const tenant = c.get('tenant')!;
      const authUser = c.get('user')!;
      const body = c.req.valid('json');

      const u = await resolveActingUser(authUser, tenantId, !!c.get('isSuperAdmin'));
      if (!u) return c.json({ error: 'tenant_user_missing' }, 422);

      // Validate every group is balanced before committing
      for (let i = 0; i < body.groups.length; i++) {
        const g = body.groups[i];
        try {
          await validateLines(tenantId, g.lines);
        } catch (e) {
          return c.json(
            {
              error: 'invalid_group',
              detail: `group ${i + 1} (${g.description}): ${(e as Error).message}`,
            },
            422,
          );
        }
      }

      try {
        const result = await commitImport({
          tenantId,
          tenantSlug: tenant.slug,
          appUserId: u.id,
          reason: body.reason,
          groups: body.groups,
        });
        if (result.importedCount > 0) {
          const { refreshReportsAfterPosting } = await import('../../../lib/cron/refresh-mat-views.js');
          await refreshReportsAfterPosting();
        }
        return c.json({ data: result });
      } catch (e) {
        return c.json({ error: 'import_failed', detail: (e as Error).message }, 500);
      }
    },
  );
