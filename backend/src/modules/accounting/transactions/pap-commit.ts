import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import {
  accountingImportBatches,
  accounts,
  funds,
  approvalLogs,
  journalLines,
  journals,
  transactionLines,
  transactions,
} from '../../../db/schema/accounting.js';
import { allocateAccountingNumber } from './numbering.js';
import { validateLines } from './service.js';
import {
  buildPAPAccountingLines,
  canonicalPAPPayloadFingerprint,
  papCommitSchema,
  type PAPCommitInput,
} from './pap-import.js';

export interface PAPCommitResult {
  batchId: string;
  duplicate: boolean;
  importedCount: number;
  fundId: string | null;
  transactionIds: string[];
  transactions: Array<{ id: string; transactionNo: string }>;
}

export class PAPCommitError extends Error {}

export async function commitPAPImport(args: {
  tenantId: string;
  tenantSlug: string;
  appUserId: string;
  input: PAPCommitInput;
}): Promise<PAPCommitResult> {
  const input = papCommitSchema.parse(args.input);
  const payloadFingerprint = canonicalPAPPayloadFingerprint(input);

  for (const row of input.rows) {
    await validateLines(args.tenantId, buildPAPAccountingLines(row, input));
  }

  return withTenant(args.tenantId, async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`pap-import:${args.tenantId}:${input.sourceFingerprint}`}))`,
    );
    const [existing] = await tx
      .select()
      .from(accountingImportBatches)
      .where(and(
        eq(accountingImportBatches.tenantId, args.tenantId),
        eq(accountingImportBatches.importType, 'pap'),
        eq(accountingImportBatches.sourceFingerprint, input.sourceFingerprint),
      ));
    if (existing?.status === 'committed' && existing.result) {
      return { ...(existing.result as unknown as PAPCommitResult), duplicate: true };
    }
    if (existing) throw new PAPCommitError('sumber import sedang diproses atau pernah gagal');

    if (input.fundId) {
      const [fund] = await tx
        .select({ id: funds.id })
        .from(funds)
        .where(and(
          eq(funds.id, input.fundId),
          eq(funds.tenantId, args.tenantId),
          eq(funds.isActive, true),
          isNull(funds.deletedAt),
        ));
      if (!fund) throw new PAPCommitError('dana PAP tidak aktif atau bukan milik tenant');
    }

    const accountIds = [...new Set([
      input.cashAccountId,
      input.incomeAccountId,
      input.expenseAccountId,
      ...input.rows.flatMap((row) => row.expenseAccountId ? [row.expenseAccountId] : []),
    ])];
    const owned = await tx
      .select({ id: accounts.id, type: accounts.accountType })
      .from(accounts)
      .where(and(
        eq(accounts.tenantId, args.tenantId),
        inArray(accounts.id, accountIds),
        eq(accounts.isActive, true),
        isNull(accounts.deletedAt),
      ));
    const byId = new Map(owned.map((account) => [account.id, account.type]));
    if (byId.get(input.cashAccountId) !== 'asset') throw new PAPCommitError('akun kas harus bertipe asset');
    if (byId.get(input.incomeAccountId) !== 'income') throw new PAPCommitError('akun penerimaan harus bertipe income');
    if (byId.get(input.expenseAccountId) !== 'expense') throw new PAPCommitError('akun pengeluaran harus bertipe expense');
    for (const row of input.rows) {
      if (row.direction === 'expense' && row.expenseAccountId && byId.get(row.expenseAccountId) !== 'expense') {
        throw new PAPCommitError('akun beban override harus bertipe expense');
      }
    }

    const [batch] = await tx.insert(accountingImportBatches).values({
      tenantId: args.tenantId,
      importType: 'pap',
      sourceType: input.sourceType,
      sourceFingerprint: input.sourceFingerprint,
      payloadFingerprint,
      fundId: input.fundId ?? null,
      reason: input.reason,
      rowCount: input.rows.length,
      status: 'processing',
      createdBy: args.appUserId,
    }).returning({ id: accountingImportBatches.id });

    const transactionIds: string[] = [];
    const importedTransactions: PAPCommitResult['transactions'] = [];
    for (const row of input.rows) {
      const date = new Date(`${row.date}T00:00:00.000Z`);
      const lines = buildPAPAccountingLines(row, input);
      const transactionNo = await allocateAccountingNumber({
        tx, tenantId: args.tenantId, tenantSlug: args.tenantSlug, date, kind: 'transaction',
      });
      const journalNo = await allocateAccountingNumber({
        tx, tenantId: args.tenantId, tenantSlug: args.tenantSlug, date, kind: 'journal',
      });
      const [transaction] = await tx.insert(transactions).values({
        tenantId: args.tenantId,
        transactionNo,
        transactionDate: date,
        amount: row.amount,
        description: row.description,
        referenceNo: row.referenceNo ?? null,
        status: 'posted',
        createdBy: args.appUserId,
        postedBy: args.appUserId,
        postedAt: new Date(),
      }).returning({ id: transactions.id });
      transactionIds.push(transaction!.id);
      importedTransactions.push({ id: transaction!.id, transactionNo });
      await tx.insert(transactionLines).values(lines.map((line, index) => ({
        transactionId: transaction!.id, ...line, sortOrder: index,
      })));
      await tx.insert(approvalLogs).values({
        transactionId: transaction!.id,
        userId: args.appUserId,
        action: 'pap_import',
        notes: input.reason,
      });
      const [journal] = await tx.insert(journals).values({
        tenantId: args.tenantId,
        journalNo,
        journalDate: date,
        transactionId: transaction!.id,
        description: row.description,
        createdBy: args.appUserId,
      }).returning({ id: journals.id });
      await tx.insert(journalLines).values(lines.map((line, index) => ({
        journalId: journal!.id, ...line, sortOrder: index,
      })));
    }

    const result: PAPCommitResult = {
      batchId: batch!.id,
      duplicate: false,
      importedCount: transactionIds.length,
      fundId: input.fundId ?? null,
      transactionIds,
      transactions: importedTransactions,
    };
    await tx.update(accountingImportBatches).set({
      status: 'committed',
      importedCount: transactionIds.length,
      result: result as unknown as Record<string, unknown>,
      updatedAt: new Date(),
      committedAt: new Date(),
    }).where(eq(accountingImportBatches.id, batch!.id));
    return result;
  });
}
