import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import {
  importedCellText,
  normalizeImportedAmount,
  normalizeImportedDate,
} from './import-normalization.js';

export type PAPDirection = 'income' | 'expense';

export interface PAPRawRow {
  date: unknown;
  description: unknown;
  referenceNo?: unknown;
  income?: unknown;
  expense?: unknown;
  balance?: unknown;
  sourceRow: number;
  sourceRef?: string;
}

export interface PAPReviewRow {
  id: string;
  date: string | null;
  description: string;
  referenceNo: string | null;
  direction: PAPDirection | null;
  amount: string | null;
  writtenBalance: string | null;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  source: {
    kind: 'excel' | 'ocr';
    row: number;
    ref: string;
    fingerprint: string;
  };
}

export const papCommitRowSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(2000),
  referenceNo: z.string().max(100).nullable().optional(),
  direction: z.enum(['income', 'expense']),
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  expenseAccountId: z.string().uuid().optional(),
});

export const papCommitSchema = z.object({
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceType: z.enum(['excel', 'ocr']),
  reason: z.string().min(10).max(2000),
  cashAccountId: z.string().uuid(),
  incomeAccountId: z.string().uuid(),
  expenseAccountId: z.string().uuid(),
  fundId: z.string().uuid().nullable().optional(),
  rows: z.array(papCommitRowSchema).min(1),
});

export type PAPCommitInput = z.infer<typeof papCommitSchema>;

export interface PAPAccountingLine {
  accountId: string;
  fundId: string | null;
  debit: string;
  credit: string;
  description: string;
}

export interface PAPImportResult {
  rows: PAPReviewRow[];
  totals: {
    income: string;
    expense: string;
    net: string;
    finalWrittenBalance: string | null;
  };
  warnings: string[];
  source: {
    kind: 'excel';
    sheetName: string;
    headerRow: number;
    fingerprint: string;
  };
}

interface NormalizePAPOptions {
  sourceKind?: 'excel' | 'ocr';
  sourceFingerprint: string;
}

type PAPColumn = 'date' | 'description' | 'referenceNo' | 'income' | 'expense' | 'balance';

const HEADER_ALIASES: Record<string, PAPColumn> = {
  tanggal: 'date',
  tgl: 'date',
  date: 'date',
  uraian: 'description',
  keterangan: 'description',
  deskripsi: 'description',
  'no bukti': 'referenceNo',
  'no. bukti': 'referenceNo',
  'nomor bukti': 'referenceNo',
  masuk: 'income',
  penerimaan: 'income',
  keluar: 'expense',
  pengeluaran: 'expense',
  saldo: 'balance',
};

export async function parsePAPExcel(
  buffer: Buffer | Uint8Array,
  sheetName?: string,
): Promise<PAPImportResult> {
  const bytes = Buffer.from(buffer);
  const sourceFingerprint = sha256(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);

  const sheet = sheetName ? findWorksheet(workbook, sheetName) : workbook.worksheets[0];
  if (!sheet) throw new Error('workbook tidak memiliki worksheet');

  const { headerRow, columns } = detectHeader(sheet);
  const rawRows: PAPRawRow[] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const raw: PAPRawRow = {
      date: row.getCell(columns.date).value,
      description: row.getCell(columns.description).value,
      referenceNo: row.getCell(columns.referenceNo).value,
      income: row.getCell(columns.income).value,
      expense: row.getCell(columns.expense).value,
      balance: row.getCell(columns.balance).value,
      sourceRow: rowNumber,
      sourceRef: `${sheet.name}!${row.getCell(columns.date).address}:${row.getCell(columns.balance).address}`,
    };
    if (!isIgnoredRow(raw)) rawRows.push(raw);
  }

  const rows = reconcilePAPReviewRows(
    normalizePAPRawRows(rawRows, { sourceKind: 'excel', sourceFingerprint }),
  );
  const totals = summarizePAPReviewRows(rows);
  const warnings = rows.flatMap((row) => row.warnings.map((warning) => `${row.source.ref}: ${warning}`));

  return {
    rows,
    totals,
    warnings,
    source: { kind: 'excel', sheetName: sheet.name, headerRow, fingerprint: sourceFingerprint },
  };
}

export function normalizePAPRawRows(
  rawRows: PAPRawRow[],
  options: NormalizePAPOptions,
): PAPReviewRow[] {
  const sourceKind = options.sourceKind ?? 'ocr';
  return rawRows.map((raw) => {
    const warnings: string[] = [];
    const date = normalizeImportedDate(raw.date);
    const income = normalizeImportedAmount(raw.income);
    const expense = normalizeImportedAmount(raw.expense);
    const balance = normalizeImportedAmount(raw.balance);

    if (!date.ok) warnings.push(date.error);
    if (!income.ok) warnings.push(`masuk: ${income.error}`);
    if (!expense.ok) warnings.push(`keluar: ${expense.error}`);
    if (!balance.ok && !balance.empty) warnings.push(`saldo: ${balance.error}`);

    const hasIncome = income.ok && !income.empty && new Decimal(income.value).gt(0);
    const hasExpense = expense.ok && !expense.empty && new Decimal(expense.value).gt(0);
    let direction: PAPDirection | null = null;
    let amount: string | null = null;
    if (hasIncome !== hasExpense) {
      direction = hasIncome ? 'income' : 'expense';
      amount = hasIncome && income.ok ? income.value : expense.ok ? expense.value : null;
    } else if (hasIncome && hasExpense) {
      warnings.push('kolom Masuk dan Keluar sama-sama terisi');
    } else {
      warnings.push('jumlah Masuk/Keluar kosong atau nol');
    }

    const description = importedCellText(raw.description);
    if (!description) warnings.push('uraian kosong');
    const ref = raw.sourceRef ?? `row:${raw.sourceRow}`;
    const fingerprint = sha256(
      `${options.sourceFingerprint}|${ref}|${date.ok ? date.value : importedCellText(raw.date)}|${description}|${amount ?? ''}`,
    );

    return {
      id: fingerprint.slice(0, 24),
      date: date.ok ? date.value : null,
      description,
      referenceNo: importedCellText(raw.referenceNo) || null,
      direction,
      amount,
      writtenBalance: balance.ok && !balance.empty ? balance.value : null,
      confidence: confidenceFor(warnings),
      warnings,
      source: { kind: sourceKind, row: raw.sourceRow, ref, fingerprint },
    };
  });
}

export function buildPAPAccountingLines(
  row: z.infer<typeof papCommitRowSchema>,
  accounts: { cashAccountId: string; incomeAccountId: string; expenseAccountId: string; fundId?: string | null },
): PAPAccountingLine[] {
  const amount = new Decimal(row.amount).toFixed(2);
  const common = { fundId: accounts.fundId ?? null, description: row.description };
  if (row.direction === 'income') {
    return [
      { ...common, accountId: accounts.cashAccountId, debit: amount, credit: '0.00' },
      { ...common, accountId: accounts.incomeAccountId, debit: '0.00', credit: amount },
    ];
  }
  return [
    { ...common, accountId: row.expenseAccountId ?? accounts.expenseAccountId, debit: amount, credit: '0.00' },
    { ...common, accountId: accounts.cashAccountId, debit: '0.00', credit: amount },
  ];
}

export function canonicalPAPPayloadFingerprint(input: PAPCommitInput): string {
  const canonical = {
    sourceFingerprint: input.sourceFingerprint,
    cashAccountId: input.cashAccountId,
    incomeAccountId: input.incomeAccountId,
    expenseAccountId: input.expenseAccountId,
    fundId: input.fundId ?? null,
    rows: input.rows.map((row) => ({
      date: row.date,
      description: row.description,
      referenceNo: row.referenceNo ?? null,
      direction: row.direction,
      amount: new Decimal(row.amount).toFixed(2),
      expenseAccountId: row.expenseAccountId ?? null,
    })),
  };
  return sha256(JSON.stringify(canonical));
}

export function reconcilePAPReviewRows(rows: PAPReviewRow[]): PAPReviewRow[] {
  let previousWrittenBalance: Decimal | null = null;
  return rows.map((row) => {
    const warnings = row.warnings.filter((warning) => !warning.startsWith('saldo berjalan tidak cocok'));
    const writtenBalance = row.writtenBalance === null ? null : new Decimal(row.writtenBalance);

    if (previousWrittenBalance !== null && writtenBalance !== null && row.direction && row.amount) {
      const signedAmount = row.direction === 'income' ? new Decimal(row.amount) : new Decimal(row.amount).negated();
      const expected = previousWrittenBalance.plus(signedAmount);
      if (!expected.eq(writtenBalance)) {
        warnings.push(
          `saldo berjalan tidak cocok: tertulis ${writtenBalance.toFixed(2)}, seharusnya ${expected.toFixed(2)}`,
        );
      }
    }
    if (writtenBalance !== null) previousWrittenBalance = writtenBalance;

    return { ...row, warnings, confidence: confidenceFor(warnings) };
  });
}

function detectHeader(sheet: ExcelJS.Worksheet): { headerRow: number; columns: Record<PAPColumn, number> } {
  for (let rowNumber = 1; rowNumber <= Math.min(30, sheet.rowCount); rowNumber++) {
    const found: Partial<Record<PAPColumn, number>> = {};
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, column) => {
      const key = HEADER_ALIASES[normalizeHeader(importedCellText(cell.value))];
      if (key && found[key] === undefined) found[key] = column;
    });
    if (['date', 'description', 'referenceNo', 'income', 'expense', 'balance'].every((key) => found[key as PAPColumn])) {
      return { headerRow: rowNumber, columns: found as Record<PAPColumn, number> };
    }
  }
  throw new Error('header PAP tidak ditemukan dalam 30 baris pertama');
}

function findWorksheet(workbook: ExcelJS.Workbook, sheetName: string): ExcelJS.Worksheet {
  const sheet = workbook.getWorksheet(sheetName) ?? workbook.worksheets.find(
    (candidate) => normalizeHeader(candidate.name) === normalizeHeader(sheetName),
  );
  if (!sheet) throw new Error(`sheet "${sheetName}" tidak ditemukan`);
  return sheet;
}

function isIgnoredRow(row: PAPRawRow): boolean {
  const values = [row.date, row.description, row.referenceNo, row.income, row.expense, row.balance];
  if (values.every((value) => importedCellText(value) === '')) return true;
  const description = normalizeHeader(importedCellText(row.description));
  const noDate = importedCellText(row.date) === '';
  return noDate && /^(?:grand\s+)?total(?:\s|$)|^jumlah(?:\s|$)/.test(description);
}

export function summarizePAPReviewRows(rows: PAPReviewRow[]): PAPImportResult['totals'] {
  let income = new Decimal(0);
  let expense = new Decimal(0);
  let finalWrittenBalance: string | null = null;
  for (const row of rows) {
    if (row.direction === 'income' && row.amount) income = income.plus(row.amount);
    if (row.direction === 'expense' && row.amount) expense = expense.plus(row.amount);
    if (row.writtenBalance !== null) finalWrittenBalance = row.writtenBalance;
  }
  return {
    income: income.toFixed(2),
    expense: expense.toFixed(2),
    net: income.minus(expense).toFixed(2),
    finalWrittenBalance,
  };
}

function confidenceFor(warnings: string[]): 'high' | 'medium' | 'low' {
  if (warnings.length === 0) return 'high';
  if (warnings.length <= 2) return 'medium';
  return 'low';
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
