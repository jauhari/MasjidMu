import { Decimal } from 'decimal.js';

export type NormalizationResult<T> =
  | { ok: true; value: T; empty: boolean }
  | { ok: false; error: string; empty: boolean };

interface FormulaResult {
  result?: unknown;
  formula?: unknown;
  sharedFormula?: unknown;
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

export function unwrapImportedValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const formula = value as FormulaResult;
    if ('result' in formula) return formula.result;
  }
  return value;
}

export function importedCellText(value: unknown): string {
  const unwrapped = unwrapImportedValue(value);
  if (unwrapped == null) return '';
  if (typeof unwrapped === 'string') return unwrapped.trim();
  if (typeof unwrapped === 'number' || typeof unwrapped === 'boolean') return String(unwrapped);
  if (unwrapped instanceof Date) return Number.isNaN(unwrapped.getTime()) ? '' : formatDate(unwrapped);
  if (typeof unwrapped === 'object') {
    const object = unwrapped as Record<string, unknown>;
    if (Array.isArray(object.richText)) {
      return (object.richText as Array<{ text?: string }>).map((part) => part.text ?? '').join('').trim();
    }
    if (object.text !== undefined) return importedCellText(object.text);
  }
  return '';
}

export function normalizeImportedAmount(value: unknown): NormalizationResult<string> {
  const unwrapped = unwrapImportedValue(value);
  if (unwrapped == null || (typeof unwrapped === 'string' && /^\s*(?:-|)\s*$/.test(unwrapped))) {
    return { ok: true, value: '0.00', empty: true };
  }

  if (typeof unwrapped === 'number') {
    if (!Number.isFinite(unwrapped)) return failure('jumlah bukan angka yang valid');
    return normalizeDecimal(new Decimal(unwrapped));
  }

  const raw = importedCellText(unwrapped);
  if (!raw) return failure('jumlah tidak memiliki hasil formula yang dapat dibaca');

  let numeric = raw
    .replace(/\b(?:rp|idr|usd)\b/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^\d.,+-]/g, '');

  if (!numeric || !/^[+-]?[\d.,]+$/.test(numeric)) return failure(`jumlah tidak valid: ${raw}`);

  const sign = numeric.startsWith('-') ? '-' : '';
  numeric = numeric.replace(/^[+-]/, '');
  if (!numeric || /[+-]/.test(numeric)) return failure(`jumlah tidak valid: ${raw}`);

  const dotCount = countCharacter(numeric, '.');
  const commaCount = countCharacter(numeric, ',');
  let canonical: string;

  if (dotCount > 0 && commaCount > 0) {
    const decimalSeparator = numeric.lastIndexOf('.') > numeric.lastIndexOf(',') ? '.' : ',';
    const thousandSeparator = decimalSeparator === '.' ? ',' : '.';
    const parts = numeric.split(decimalSeparator);
    if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1]!)) return failure(`jumlah tidak valid: ${raw}`);
    if (!validGroupedInteger(parts[0]!, thousandSeparator)) return failure(`jumlah tidak valid: ${raw}`);
    canonical = `${parts[0]!.split(thousandSeparator).join('')}.${parts[1]}`;
  } else if (dotCount > 0 || commaCount > 0) {
    const separator = dotCount > 0 ? '.' : ',';
    const parts = numeric.split(separator);
    if (parts.some((part) => !/^\d+$/.test(part))) return failure(`jumlah tidak valid: ${raw}`);
    if (parts.length > 2 || (parts.length === 2 && parts[1]!.length === 3)) {
      if (!validGroupedInteger(numeric, separator)) return failure(`jumlah tidak valid: ${raw}`);
      canonical = parts.join('');
    } else if (parts.length === 2 && parts[1]!.length <= 2) {
      canonical = `${parts[0]}.${parts[1]}`;
    } else {
      return failure(`jumlah tidak valid: ${raw}`);
    }
  } else {
    canonical = numeric;
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(canonical)) return failure(`jumlah tidak valid: ${raw}`);
  try {
    return normalizeDecimal(new Decimal(`${sign}${canonical}`));
  } catch {
    return failure(`jumlah tidak valid: ${raw}`);
  }
}

export function normalizeImportedDate(value: unknown): NormalizationResult<string> {
  const unwrapped = unwrapImportedValue(value);
  if (unwrapped == null || (typeof unwrapped === 'string' && !unwrapped.trim())) {
    return { ok: false, error: 'tanggal kosong', empty: true };
  }

  if (unwrapped instanceof Date) {
    if (Number.isNaN(unwrapped.getTime())) return failure('tanggal tidak valid');
    return { ok: true, value: formatDate(unwrapped), empty: false };
  }

  if (typeof unwrapped === 'number') {
    if (!Number.isFinite(unwrapped) || unwrapped <= 0) return failure('serial tanggal Excel tidak valid');
    const wholeDays = Math.floor(unwrapped);
    const date = new Date(EXCEL_EPOCH_UTC + wholeDays * 86_400_000);
    return { ok: true, value: formatDate(date), empty: false };
  }

  const raw = importedCellText(unwrapped);
  if (!raw) return failure('tanggal tidak memiliki hasil formula yang dapat dibaca');

  const localMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (localMatch) {
    const year = localMatch[3]!.length === 2 ? 2000 + Number(localMatch[3]) : Number(localMatch[3]);
    return datePartsResult(year, Number(localMatch[2]), Number(localMatch[1]), raw);
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) return datePartsResult(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]), raw);

  return failure(`tanggal tidak valid: ${raw}`);
}

function normalizeDecimal(value: Decimal): NormalizationResult<string> {
  if (!value.isFinite()) return failure('jumlah bukan angka yang valid');
  if (value.isNegative()) return failure('jumlah tidak boleh negatif');
  return { ok: true, value: value.toFixed(2), empty: false };
}

function datePartsResult(year: number, month: number, day: number, raw: string): NormalizationResult<string> {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return failure(`tanggal tidak valid: ${raw}`);
  }
  return { ok: true, value: formatDate(date), empty: false };
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function validGroupedInteger(value: string, separator: string): boolean {
  const escaped = separator === '.' ? '\\.' : ',';
  return new RegExp(`^\\d{1,3}(?:${escaped}\\d{3})+$`).test(value);
}

function countCharacter(value: string, character: string): number {
  return value.split(character).length - 1;
}

function failure(error: string): NormalizationResult<never> {
  return { ok: false, error, empty: false };
}
