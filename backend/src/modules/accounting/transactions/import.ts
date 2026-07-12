/**
 * Historical journal import — parses .xlsx (uploaded or fetched from
 * Google Sheets export endpoint) into grouped multi-line transactions.
 *
 * Supports two header layouts (auto-detected):
 *
 *   Format A — "per-line" (1 row = 1 journal line)
 *     Tanggal | Keterangan | (Sub Akun) | Akun | Debit | Kredit
 *     Consecutive rows with same Tanggal+Keterangan = 1 transaction.
 *
 *   Format B — "per-transaction" (1 row = 1 transaction, 2 lines)
 *     Tanggal | (No. Bukti) | Keterangan | (Jenis) | (Rekanan) | (Program) |
 *     Akun Debet | Akun Kredit | Jumlah
 *     Each row produces 2 lines: debit-account / credit-account, both = Jumlah.
 *     This is the layout used by the legacy Google Sheets workbook.
 *
 * Account names may include a code prefix (e.g. "5-107 | Biaya WKSBM").
 * Matching strategy:
 *   1. Exact name (case-insensitive)
 *   2. Code prefix match — extract the part before "|" or whitespace
 *   3. Otherwise → unmatched, surfaced for manual mapping in UI
 *
 * Cell values may be formula objects: { formula, result }. We always use
 * the cached `result` when present, falling back to the formula string.
 *
 * Commit pipeline (god_mode permission):
 *   1. Validate every group balanced (sum debit == sum credit)
 *   2. Insert transaction (categoryId=null, manual)
 *   3. Insert N transaction_lines (resolved accountId per line)
 *   4. Run generateJournalForPostedImport() → status='posted', journal+lines
 *
 * Audit log entry per import row with reason.
 */
import ExcelJS from 'exceljs';
import { Decimal } from 'decimal.js';
import { and, eq, isNull } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import {
  accounts,
  approvalLogs,
  journalLines,
  journals,
  transactionLines,
  transactions,
} from '../../../db/schema/accounting.js';
import { normalizeImportedAmount, normalizeImportedDate } from './import-normalization.js';
import { allocateAccountingNumber } from './numbering.js';

// ─── Types ─────────────────────────────────────────────────────────────────
type Layout = 'per_line' | 'per_tx';

export interface ParsedLine {
  rowIndex: number;
  accountName: string;
  subAccountName: string | null;
  debit: string;
  credit: string;
  matchedAccountId: string | null;
  matchedAccountCode: string | null;
}

export interface ParsedGroup {
  groupId: string;
  date: string;
  description: string;
  referenceNo: string | null;
  lines: ParsedLine[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  warning: string | null;
}

export interface ParseResult {
  layout: Layout;
  groups: ParsedGroup[];
  unmatchedAccountNames: string[];
  totalRows: number;
  errors: Array<{ row: number; message: string }>;
}

// ─── Header alias mapping ──────────────────────────────────────────────────
type HeaderKey =
  | 'date'
  | 'description'
  | 'subAccount'
  | 'account'
  | 'accountDebit'
  | 'accountCredit'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'referenceNo';

const HEADER_ALIASES: Record<string, HeaderKey> = {
  // date
  tanggal: 'date',
  date: 'date',
  tgl: 'date',
  // description
  keterangan: 'description',
  deskripsi: 'description',
  description: 'description',
  uraian: 'description',
  // sub account (optional)
  'sub akun': 'subAccount',
  subakun: 'subAccount',
  'sub account': 'subAccount',
  // single account (per-line layout)
  akun: 'account',
  account: 'account',
  // dual account (per-tx layout)
  'akun debet': 'accountDebit',
  'akun debit': 'accountDebit',
  'account debit': 'accountDebit',
  debit_account: 'accountDebit',
  'akun kredit': 'accountCredit',
  'akun credit': 'accountCredit',
  'account credit': 'accountCredit',
  credit_account: 'accountCredit',
  // amount (per-tx layout)
  jumlah: 'amount',
  amount: 'amount',
  nominal: 'amount',
  total: 'amount',
  // debit/credit columns (per-line layout)
  debit: 'debit',
  debet: 'debit',
  kredit: 'credit',
  credit: 'credit',
  // reference no (optional)
  'no. bukti': 'referenceNo',
  'no bukti': 'referenceNo',
  'nomor bukti': 'referenceNo',
  ref: 'referenceNo',
  reference: 'referenceNo',
};

// ─── Cell value helpers ────────────────────────────────────────────────────
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Extract a string from any ExcelJS cell value.
 * Handles formula objects, rich text, dates, numbers.
 */
function cellString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return v.toISOString();
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // Formula cell: prefer cached result
    if ('result' in o && o.result !== null && o.result !== undefined) {
      return cellString(o.result);
    }
    // Rich text cell
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('').trim();
    }
    if ('text' in o && o.text !== undefined) return cellString(o.text);
    if ('formula' in o) return ''; // unevaluated formula → blank
  }
  try {
    return String(v).trim();
  } catch {
    return '';
  }
}

function parseAmount(v: unknown): ReturnType<typeof normalizeImportedAmount> {
  return normalizeImportedAmount(v);
}

function parseDate(v: unknown): ReturnType<typeof normalizeImportedDate> {
  return normalizeImportedDate(v);
}

/**
 * Strip the COA code prefix from "5-107 | Biaya WKSBM" → "Biaya WKSBM".
 * Returns both parts for matching purposes.
 */
function splitAccountLabel(label: string): { code: string | null; name: string } {
  const m = label.match(/^\s*([\w\d.-]+)\s*[|:-]\s*(.+)$/);
  if (m) return { code: m[1]!.trim(), name: m[2]!.trim() };
  return { code: null, name: label.trim() };
}

// ─── Parse ─────────────────────────────────────────────────────────────────
export async function parseImportFile(
  buffer: Buffer | Uint8Array,
  sheetName = 'JURNAL',
): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  let sheet = wb.getWorksheet(sheetName);
  if (!sheet) {
    const found = wb.worksheets.find((w) => normalize(w.name) === normalize(sheetName));
    if (!found) {
      const names = wb.worksheets.map((w) => w.name).join(', ');
      throw new Error(`sheet "${sheetName}" not found. Available: ${names}`);
    }
    sheet = found;
  }

  // Locate header row in first 30 rows. Match priority: at least 3 known headers.
  const colIndex: Partial<Record<HeaderKey, number>> = {};
  let headerRow = -1;
  for (let r = 1; r <= Math.min(30, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    const localCols: Partial<Record<HeaderKey, number>> = {};
    let matched = 0;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = HEADER_ALIASES[normalize(cellString(cell.value))];
      if (key && !(key in localCols)) {
        localCols[key] = col;
        matched++;
      }
    });
    if (matched >= 3) {
      Object.assign(colIndex, localCols);
      headerRow = r;
      break;
    }
  }
  if (headerRow === -1) {
    throw new Error(
      'header row not found (need at least 3 of: Tanggal, Keterangan, Akun/Akun Debet/Akun Kredit, Debit/Kredit, Jumlah)',
    );
  }

  // Detect layout
  const layout: Layout =
    colIndex.accountDebit !== undefined && colIndex.accountCredit !== undefined && colIndex.amount !== undefined
      ? 'per_tx'
      : 'per_line';

  if (!colIndex.date) throw new Error('column "Tanggal" not found in header');
  if (layout === 'per_line') {
    if (!colIndex.account) throw new Error('column "Akun" not found in header');
    if (!colIndex.debit || !colIndex.credit) {
      throw new Error('columns "Debit" and "Kredit" required for per-line layout');
    }
  }

  const errors: ParseResult['errors'] = [];
  const groups: ParsedGroup[] = [];

  if (layout === 'per_tx') {
    // Each non-empty data row → one group with 2 lines.
    let groupCounter = 0;
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const dateResult = parseDate(row.getCell(colIndex.date).value);
      const desc = colIndex.description ? cellString(row.getCell(colIndex.description).value) : '';
      const refNo = colIndex.referenceNo ? cellString(row.getCell(colIndex.referenceNo).value) || null : null;
      const dbAcc = colIndex.accountDebit ? cellString(row.getCell(colIndex.accountDebit).value) : '';
      const crAcc = colIndex.accountCredit ? cellString(row.getCell(colIndex.accountCredit).value) : '';
      const amountResult = parseAmount(row.getCell(colIndex.amount!).value);

      if (dateResult.empty && !desc && !dbAcc && !crAcc && amountResult.ok && amountResult.empty) continue;
      if (!dateResult.ok) {
        if (dbAcc || crAcc || !amountResult.empty) errors.push({ row: r, message: dateResult.error });
        continue;
      }
      if (!amountResult.ok) {
        errors.push({ row: r, message: amountResult.error });
        continue;
      }
      if (!dbAcc || !crAcc) {
        errors.push({ row: r, message: 'akun debet/kredit kosong' });
        continue;
      }
      if (amountResult.value === '0.00') {
        errors.push({ row: r, message: 'jumlah kosong/nol' });
        continue;
      }
      const date = dateResult.value;
      const amount = amountResult.value;

      groupCounter++;
      groups.push({
        groupId: `g${groupCounter}`,
        date,
        description: desc || '(tanpa keterangan)',
        referenceNo: refNo,
        lines: [
          {
            rowIndex: r,
            accountName: dbAcc,
            subAccountName: null,
            debit: amount,
            credit: '0',
            matchedAccountId: null,
            matchedAccountCode: null,
          },
          {
            rowIndex: r,
            accountName: crAcc,
            subAccountName: null,
            debit: '0',
            credit: amount,
            matchedAccountId: null,
            matchedAccountCode: null,
          },
        ],
        totalDebit: amount,
        totalCredit: amount,
        balanced: true,
        warning: null,
      });
    }
    return { layout, groups, unmatchedAccountNames: [], totalRows: groups.length, errors };
  }

  // ── per-line layout ──
  interface RawLine {
    rowIndex: number;
    date: string;
    description: string;
    account: string;
    subAccount: string | null;
    debit: string;
    credit: string;
  }
  const rawLines: RawLine[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const dateResult = parseDate(row.getCell(colIndex.date).value);
    const desc = colIndex.description ? cellString(row.getCell(colIndex.description).value) : '';
    const acc = colIndex.account ? cellString(row.getCell(colIndex.account).value) : '';
    const sub = colIndex.subAccount ? cellString(row.getCell(colIndex.subAccount).value) || null : null;
    const debitResult = parseAmount(row.getCell(colIndex.debit!).value);
    const creditResult = parseAmount(row.getCell(colIndex.credit!).value);

    if (!acc && debitResult.ok && debitResult.empty && creditResult.ok && creditResult.empty) continue;
    if (!dateResult.ok) {
      if (acc || !debitResult.empty || !creditResult.empty) errors.push({ row: r, message: dateResult.error });
      continue;
    }
    if (!debitResult.ok || !creditResult.ok) {
      const messages = [
        !debitResult.ok ? `debit: ${debitResult.error}` : null,
        !creditResult.ok ? `kredit: ${creditResult.error}` : null,
      ].filter((message): message is string => message !== null);
      errors.push({ row: r, message: messages.join('; ') });
      continue;
    }
    const debit = debitResult.value;
    const credit = creditResult.value;
    if (!acc) {
      errors.push({ row: r, message: 'akun kosong' });
      continue;
    }
    if (debit === '0.00' && credit === '0.00') {
      errors.push({ row: r, message: 'debit & kredit kosong' });
      continue;
    }
    if (debit !== '0.00' && credit !== '0.00') {
      errors.push({ row: r, message: 'debit DAN kredit terisi (harus salah satu)' });
      continue;
    }
    rawLines.push({
      rowIndex: r,
      date: dateResult.value,
      description: desc,
      account: acc,
      subAccount: sub,
      debit,
      credit,
    });
  }

  // Group consecutive rows by date+description
  let groupCounter = 0;
  let current: ParsedGroup | null = null;
  for (const l of rawLines) {
    if (!current || current.date !== l.date || current.description !== l.description) {
      if (current) groups.push(current);
      groupCounter++;
      current = {
        groupId: `g${groupCounter}`,
        date: l.date,
        description: l.description || '(tanpa keterangan)',
        referenceNo: null,
        lines: [],
        totalDebit: '0',
        totalCredit: '0',
        balanced: false,
        warning: null,
      };
    }
    current.lines.push({
      rowIndex: l.rowIndex,
      accountName: l.account,
      subAccountName: l.subAccount,
      debit: l.debit,
      credit: l.credit,
      matchedAccountId: null,
      matchedAccountCode: null,
    });
  }
  if (current) groups.push(current);

  for (const g of groups) {
    const d = g.lines.reduce((acc, l) => acc.plus(new Decimal(l.debit)), new Decimal(0));
    const c = g.lines.reduce((acc, l) => acc.plus(new Decimal(l.credit)), new Decimal(0));
    g.totalDebit = d.toFixed(2);
    g.totalCredit = c.toFixed(2);
    g.balanced = d.eq(c) && d.gt(0);
    if (!g.balanced) g.warning = `tidak balance (D=${g.totalDebit} K=${g.totalCredit})`;
    else if (g.lines.length < 2) {
      g.warning = 'minimal 2 baris';
      g.balanced = false;
    }
  }

  return { layout, groups, unmatchedAccountNames: [], totalRows: rawLines.length, errors };
}

// ─── Account matching ──────────────────────────────────────────────────────
/**
 * Match account labels against tenant COA. Strategy:
 *   1. Exact name (case-insensitive)
 *   2. Code prefix (e.g. "5-107 | Biaya X" → match by COA code "5-107" or "5107")
 * Mutates groups in place. Returns sorted unique unmatched labels.
 */
export async function matchAccounts(tenantId: string, groups: ParsedGroup[]): Promise<string[]> {
  const coa = await withTenant(tenantId, async (db) =>
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt), eq(accounts.isActive, true))),
  );

  const byName = new Map<string, { id: string; code: string; name: string }>();
  const byCode = new Map<string, { id: string; code: string; name: string }>();
  const byCodeStripped = new Map<string, { id: string; code: string; name: string }>();
  for (const a of coa) {
    byName.set(normalize(a.name), a);
    byCode.set(a.code.toLowerCase(), a);
    byCodeStripped.set(a.code.replace(/[^\w\d]/g, '').toLowerCase(), a);
  }

  const unmatched = new Set<string>();
  for (const g of groups) {
    for (const line of g.lines) {
      const { code: rawCode, name } = splitAccountLabel(line.accountName);

      let hit = byName.get(normalize(name));
      if (!hit && rawCode) {
        hit = byCode.get(rawCode.toLowerCase()) ?? byCodeStripped.get(rawCode.replace(/[^\w\d]/g, '').toLowerCase());
      }
      if (!hit) hit = byName.get(normalize(line.accountName));

      if (hit) {
        line.matchedAccountId = hit.id;
        line.matchedAccountCode = hit.code;
      } else {
        unmatched.add(line.accountName);
      }
    }
  }
  return Array.from(unmatched).sort();
}

// ─── Commit ────────────────────────────────────────────────────────────────
export interface CommitGroup {
  date: string;
  description: string;
  referenceNo?: string | null;
  lines: Array<{
    accountId: string;
    /** Dana (fund) tag — PSAK 109. Optional; null for single-fund tenants. */
    fundId?: string | null;
    debit: string;
    credit: string;
    description?: string | null;
  }>;
}

export interface CommitResult {
  importedCount: number;
  failedCount: number;
  failures: Array<{ index: number; description: string; error: string }>;
}

export async function commitImport(args: {
  tenantId: string;
  tenantSlug: string;
  appUserId: string;
  reason: string;
  groups: CommitGroup[];
}): Promise<CommitResult> {
  const { tenantId, tenantSlug, appUserId, reason, groups } = args;
  const failures: CommitResult['failures'] = [];
  let importedCount = 0;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    try {
      const txDate = new Date(g.date);
      if (isNaN(txDate.getTime())) throw new Error('invalid date');

      const totalAmount = g.lines
        .reduce((a, l) => a.plus(new Decimal(l.debit || '0')), new Decimal(0))
        .toFixed(2);

      // Single tenant-scoped transaction for the whole insert+post pipeline.
      // The deferred journal_lines balance trigger fires at COMMIT — if any
      // step fails the entire group rolls back cleanly.
      await withTenant(tenantId, async (db) => {
        const transactionNo = await allocateAccountingNumber({
          tx: db,
          tenantId,
          tenantSlug,
          date: txDate,
          kind: 'transaction',
        });
        const journalNo = await allocateAccountingNumber({
          tx: db,
          tenantId,
          tenantSlug,
          date: txDate,
          kind: 'journal',
        });
        const [t] = await db
          .insert(transactions)
          .values({
            tenantId,
            transactionNo,
            transactionDate: txDate,
            categoryId: null,
            amount: totalAmount,
            description: g.description,
            referenceNo: g.referenceNo ?? null,
            status: 'draft',
            createdBy: appUserId,
          })
          .returning();

        await db.insert(transactionLines).values(
          g.lines.map((l, idx) => ({
            transactionId: t!.id,
            accountId: l.accountId,
            fundId: l.fundId ?? null,
            debit: l.debit || '0',
            credit: l.credit || '0',
            description: l.description ?? null,
            sortOrder: idx,
          })),
        );

        await db.insert(approvalLogs).values({
          transactionId: t!.id,
          userId: appUserId,
          action: 'import',
          notes: `historical import: ${reason}`,
        });

        // Inline journal generation (cannot use generateJournalForPostedImport()
        // because it opens a new transaction and would not see this one yet).
        const [j] = await db
          .insert(journals)
          .values({
            tenantId,
            journalNo,
            journalDate: txDate,
            transactionId: t!.id,
            description: g.description ?? `Imported journal for ${transactionNo}`,
            createdBy: appUserId,
          })
          .returning({ id: journals.id });

        await db.insert(journalLines).values(
          g.lines.map((l, idx) => ({
            journalId: j!.id,
            accountId: l.accountId,
            fundId: l.fundId ?? null,
            debit: l.debit || '0',
            credit: l.credit || '0',
            description: l.description ?? null,
            sortOrder: idx,
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
          .where(eq(transactions.id, t!.id));
      });

      importedCount++;
    } catch (e) {
      failures.push({
        index: i,
        description: g.description,
        error: (e as Error).message,
      });
    }
  }

  return { importedCount, failedCount: failures.length, failures };
}

void and;
void isNull;
void approvalLogs;
