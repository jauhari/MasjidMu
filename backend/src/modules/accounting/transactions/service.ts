/**
 * Transaction service — multi-line double-entry, state machine, posting + journal.
 *
 * Each transaction owns N transaction_lines. SUM(debit) = SUM(credit) is enforced
 * at COMMIT time by trigger (see 060_transaction_lines.sql).
 *
 * Posting is atomic with journal generation: status goes to `posted` and
 * journal+lines are inserted in the same tx — lines are 1:1 cloned from
 * transaction_lines (no more category lookup at posting time).
 *
 * Journal numbering: `JRN-{TENANT4}-{YYYYMM}-{NNNN}` (NNNN = monthly counter).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../db/client.js';
import {
  accounts,
  approvalLogs,
  approvalStages,
  funds,
  journalLines,
  journals,
  transactionLines,
  transactions,
} from '../../../db/schema/accounting.js';
import {
  IllegalTransitionError,
  canTransition,
} from './state-machine.js';
import { validateJournalEntries } from '../_validators/financial.js';
import type { TransactionStatus } from '../types.js';

export class TransactionNotFoundError extends Error {
  constructor() {
    super('transaction not found');
  }
}

export class JournalAlreadyPostedError extends Error {
  constructor() {
    super('journal already exists for this transaction');
  }
}

export class UnbalancedLinesError extends Error {
  constructor(public debit: string, public credit: string) {
    super(`lines unbalanced: debit=${debit} credit=${credit}`);
  }
}

export class InvalidLinesError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface LineInput {
  accountId: string;
  debit: string;
  credit: string;
  description?: string | null;
  /** Optional fund (Dana) tag — PSAK 109. Null for single-fund (masjid) data. */
  fundId?: string | null;
}

/**
 * Validate lines:
 *   - at least 2 lines
 *   - each line: exactly one of debit/credit > 0
 *   - sum(debit) === sum(credit)
 *   - all accountIds exist in tenant and are active
 */
export async function validateLines(tenantId: string, lines: LineInput[]): Promise<void> {
  if (lines.length < 2) throw new InvalidLinesError('at least 2 lines required');

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);

  for (const l of lines) {
    const d = new Decimal(l.debit || '0');
    const c = new Decimal(l.credit || '0');
    if (d.lt(0) || c.lt(0)) throw new InvalidLinesError('debit/credit must be non-negative');
    if (d.gt(0) && c.gt(0)) throw new InvalidLinesError('a line must be either debit or credit, not both');
    if (d.eq(0) && c.eq(0)) throw new InvalidLinesError('each line must have either debit or credit');
    totalDebit = totalDebit.plus(d);
    totalCredit = totalCredit.plus(c);
  }

  if (!totalDebit.eq(totalCredit)) {
    throw new UnbalancedLinesError(totalDebit.toFixed(2), totalCredit.toFixed(2));
  }

  // Verify all account ids belong to tenant + active
  const accIds = Array.from(new Set(lines.map((l) => l.accountId)));
  const validAccs = await withTenant(tenantId, async (db) =>
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt), eq(accounts.isActive, true))),
  );
  const validIds = new Set(validAccs.map((a) => a.id));
  for (const id of accIds) {
    if (!validIds.has(id)) throw new InvalidLinesError(`invalid account: ${id}`);
  }

  // Verify fund ids (if provided) belong to tenant + active.
  const fundIds = Array.from(
    new Set(lines.map((l) => l.fundId).filter((x): x is string => !!x)),
  );
  if (fundIds.length > 0) {
    const validFunds = await withTenant(tenantId, async (db) =>
      db
        .select({ id: funds.id })
        .from(funds)
        .where(and(eq(funds.tenantId, tenantId), isNull(funds.deletedAt), eq(funds.isActive, true))),
    );
    const validFundIds = new Set(validFunds.map((f) => f.id));
    for (const id of fundIds) {
      if (!validFundIds.has(id)) throw new InvalidLinesError(`invalid fund: ${id}`);
    }
  }
}

/** Replace all lines for a transaction (delete old, insert new). */
export async function replaceLines(tenantId: string, txId: string, lines: LineInput[]): Promise<void> {
  await validateLines(tenantId, lines);
  await withTenant(tenantId, async (db) => {
    await db.delete(transactionLines).where(eq(transactionLines.transactionId, txId));
    await db.insert(transactionLines).values(
      lines.map((l, i) => ({
        transactionId: txId,
        accountId: l.accountId,
        fundId: l.fundId ?? null,
        debit: l.debit || '0',
        credit: l.credit || '0',
        description: l.description ?? null,
        sortOrder: i,
      })),
    );
  });
}

/** Compute total amount from lines (= sum of debits = sum of credits). */
export function totalFromLines(lines: LineInput[]): string {
  return lines
    .reduce((acc, l) => acc.plus(new Decimal(l.debit || '0')), new Decimal(0))
    .toFixed(2);
}

/** Generate `JRN-{tenant4}-{YYYYMM}-{NNNN}` — atomic via row lock. */
async function generateJournalNo(
  tenantId: string,
  tenantSlug: string,
  date: Date,
): Promise<string> {
  const yyyymm = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return withTenant(tenantId, async (tx) => {
    // Advisory lock: serialise journal number generation per tenant.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`);
    const tenantPrefix = tenantSlug.slice(0, 4).toUpperCase().padEnd(4, 'X');
    // Extract MAX sequence from existing journal_no untuk tenant + bulan ini.
    // Pakai MAX (bukan COUNT) supaya setelah force-edit (hapus jurnal lama),
    // nomor gak mundur dan bentrok sama jurnal yg udah pernah ada.
    const maxResult = await tx.execute(sql`
      SELECT journal_no FROM journals
       WHERE tenant_id = ${tenantId}
         AND journal_no LIKE ${`JRN-${tenantPrefix}-${yyyymm}-%`}
       ORDER BY journal_no DESC
       LIMIT 1
    `);
    const lastJournal = (maxResult.rows[0] as { journal_no: string } | undefined)?.journal_no;
    let seq = 1;
    if (lastJournal) {
      const match = lastJournal.match(/-(\d{4})$/);
      if (match) seq = (parseInt(match[1], 10) % 9999) + 1;
    }
    return `JRN-${tenantPrefix}-${yyyymm}-${String(seq).padStart(4, '0')}`;
  });
}

/**
 * Transition a transaction. Always validates allowed transitions.
 */
export async function transitionStatus(
  tenantId: string,
  txId: string,
  to: TransactionStatus,
  actorAuthUserId: string,
  notes?: string,
): Promise<{ id: string; status: TransactionStatus }> {
  return withTenant(tenantId, async (db) => {
    const [current] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, txId), isNull(transactions.deletedAt)));
    if (!current) throw new TransactionNotFoundError();

    if (!canTransition(current.status, to)) {
      throw new IllegalTransitionError(current.status, to);
    }

    const [updated] = await db
      .update(transactions)
      .set({
        status: to,
        ...(to === 'submitted' && { submittedAt: new Date() }),
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, txId))
      .returning({ id: transactions.id, status: transactions.status });

    void actorAuthUserId;
    void notes;

    return updated!;
  });
}

/**
 * Post a transaction (approved → posted). Clones transaction_lines into
 * journal_lines in the SAME tenant-scoped tx. The DB-level balance trigger
 * on journal_lines fires together with the status update; if it rejects,
 * everything rolls back.
 */
export async function postTransaction(args: {
  tenantId: string;
  tenantSlug: string;
  transactionId: string;
  appUserId: string;
}): Promise<{ id: string; journalId: string; journalNo: string }> {
  const { tenantId, tenantSlug, transactionId, appUserId } = args;
  return withTenant(tenantId, async (db) => {
    const [tx] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), isNull(transactions.deletedAt)));
    if (!tx) throw new TransactionNotFoundError();
    if (!canTransition(tx.status, 'posted')) {
      throw new IllegalTransitionError(tx.status, 'posted');
    }

    const dup = await db
      .select({ id: journals.id })
      .from(journals)
      .where(eq(journals.transactionId, tx.id));
    if (dup[0]) throw new JournalAlreadyPostedError();

    const lines = await db
      .select()
      .from(transactionLines)
      .where(eq(transactionLines.transactionId, tx.id));
    if (lines.length < 2) throw new InvalidLinesError('transaction has fewer than 2 lines');

    const v = validateJournalEntries(
      lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })),
    );
    if (!v.valid) throw new Error(`validator: ${v.errors.join('; ')}`);

    const journalNo = await generateJournalNo(tenantId, tenantSlug, tx.transactionDate);

    const [j] = await db
      .insert(journals)
      .values({
        tenantId,
        journalNo,
        journalDate: tx.transactionDate,
        transactionId: tx.id,
        description: tx.description ?? `Auto-journal for ${tx.transactionNo}`,
        createdBy: appUserId,
      })
      .returning({ id: journals.id, journalNo: journals.journalNo });

    await db.insert(journalLines).values(
      lines.map((l, i) => ({
        journalId: j!.id,
        accountId: l.accountId,
        fundId: l.fundId ?? null,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
        sortOrder: i,
      })),
    );

    await db
      .update(transactions)
      .set({
        status: 'posted',
        postedAt: new Date(),
        postedBy: appUserId,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, tx.id));

    await db.insert(approvalLogs).values({
      transactionId: tx.id,
      userId: appUserId,
      action: 'post',
      notes: `journal=${j!.journalNo}`,
    });

    return { id: tx.id, journalId: j!.id, journalNo: j!.journalNo };
  });
}

/**
 * Bypass state machine: post directly from draft → posted (used by historical
 * import only). Wraps postTransaction's core but skips canTransition() guard.
 * Called inside an existing withTenant context.
 */
export async function generateJournalForPostedImport(args: {
  tenantId: string;
  tenantSlug: string;
  transactionId: string;
  appUserId: string;
}): Promise<{ id: string; journalId: string; journalNo: string }> {
  const { tenantId, tenantSlug, transactionId, appUserId } = args;
  return withTenant(tenantId, async (db) => {
    const [tx] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), isNull(transactions.deletedAt)));
    if (!tx) throw new TransactionNotFoundError();

    const dup = await db
      .select({ id: journals.id })
      .from(journals)
      .where(eq(journals.transactionId, tx.id));
    if (dup[0]) throw new JournalAlreadyPostedError();

    const lines = await db
      .select()
      .from(transactionLines)
      .where(eq(transactionLines.transactionId, tx.id));
    if (lines.length < 2) throw new InvalidLinesError('transaction has fewer than 2 lines');

    const v = validateJournalEntries(
      lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })),
    );
    if (!v.valid) throw new Error(`validator: ${v.errors.join('; ')}`);

    const journalNo = await generateJournalNo(tenantId, tenantSlug, tx.transactionDate);

    const [j] = await db
      .insert(journals)
      .values({
        tenantId,
        journalNo,
        journalDate: tx.transactionDate,
        transactionId: tx.id,
        description: tx.description ?? `Imported journal for ${tx.transactionNo}`,
        createdBy: appUserId,
      })
      .returning({ id: journals.id, journalNo: journals.journalNo });

    await db.insert(journalLines).values(
      lines.map((l, i) => ({
        journalId: j!.id,
        accountId: l.accountId,
        fundId: l.fundId ?? null,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
        sortOrder: i,
      })),
    );

    await db
      .update(transactions)
      .set({
        status: 'posted',
        postedAt: new Date(),
        postedBy: appUserId,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, tx.id));

    return { id: tx.id, journalId: j!.id, journalNo: j!.journalNo };
  });
}

/**
 * GOD MODE force-edit: super_admin only. Hard-deletes existing journal lines
 * (if posted), replaces transaction lines, optionally regenerates journal.
 *
 * - status `posted`: delete old journal + journal_lines, will be regenerated
 *   if user calls post() again. Status reset to `approved`.
 * - other statuses: just replace lines, status unchanged.
 *
 * Mandatory audit log entry with reason.
 */
export async function forceEditTransaction(args: {
  tenantId: string;
  transactionId: string;
  appUserId: string;
  reason: string;
  header?: { transactionDate?: Date; description?: string | null; referenceNo?: string | null; categoryId?: string | null };
  lines: LineInput[];
}): Promise<{ id: string; status: TransactionStatus }> {
  const { tenantId, transactionId, appUserId, reason, header, lines } = args;
  if (!reason || reason.trim().length < 10) {
    throw new InvalidLinesError('reason required (min 10 chars) for force-edit');
  }

  await validateLines(tenantId, lines);

  return withTenant(tenantId, async (db) => {
    const [tx] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), isNull(transactions.deletedAt)));
    if (!tx) throw new TransactionNotFoundError();

    // Posted? Drop the journal + journal_lines so it can be reposted cleanly.
    if (tx.status === 'posted') {
      await db.delete(journals).where(eq(journals.transactionId, tx.id));
    }

    // Replace transaction lines.
    await db.delete(transactionLines).where(eq(transactionLines.transactionId, tx.id));
    await db.insert(transactionLines).values(
      lines.map((l, i) => ({
        transactionId: tx.id,
        accountId: l.accountId,
        fundId: l.fundId ?? null,
        debit: l.debit || '0',
        credit: l.credit || '0',
        description: l.description ?? null,
        sortOrder: i,
      })),
    );

    // Update header + recompute amount.
    const newAmount = totalFromLines(lines);
    const [updated] = await db
      .update(transactions)
      .set({
        ...(header?.transactionDate && { transactionDate: header.transactionDate }),
        ...(header?.description !== undefined && { description: header.description }),
        ...(header?.referenceNo !== undefined && { referenceNo: header.referenceNo }),
        ...(header?.categoryId !== undefined && { categoryId: header.categoryId }),
        amount: newAmount,
        ...(tx.status === 'posted' && { status: 'approved' as const, postedAt: null, postedBy: null }),
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, tx.id))
      .returning({ id: transactions.id, status: transactions.status });

    await db.insert(approvalLogs).values({
      transactionId: tx.id,
      userId: appUserId,
      action: 'force_edit',
      notes: reason,
    });

    return updated!;
  });
}

/** GOD MODE force-delete: hard-delete tx + lines + journal. Audit logged. */
export async function forceDeleteTransaction(args: {
  tenantId: string;
  transactionId: string;
  appUserId: string;
  reason: string;
}): Promise<void> {
  const { tenantId, transactionId, appUserId, reason } = args;
  if (!reason || reason.trim().length < 10) {
    throw new InvalidLinesError('reason required (min 10 chars) for force-delete');
  }

  await withTenant(tenantId, async (db) => {
    const [tx] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), isNull(transactions.deletedAt)));
    if (!tx) throw new TransactionNotFoundError();

    // Audit log BEFORE delete (cascade would wipe it otherwise).
    await db.insert(approvalLogs).values({
      transactionId: tx.id,
      userId: appUserId,
      action: 'force_delete',
      notes: reason,
    });

    // Soft-delete (preserve audit trail). Also nuke journal so balances stay clean.
    await db.delete(journals).where(eq(journals.transactionId, tx.id));
    await db
      .update(transactions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(transactions.id, tx.id));
  });
}

void approvalStages;
