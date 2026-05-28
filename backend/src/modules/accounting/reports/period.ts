/**
 * Period parsing for report endpoints.
 *
 * Accepts either:
 *   - month + year             → calendar month period
 *   - startDate + endDate      → custom range (overrides month/year)
 *
 * Optional companion comparePeriod uses the same shape, prefixed with
 * `compare`. Returns dates in UTC; downstream queries cast journal_date to
 * UTC dates so this is consistent with how journals are stored.
 */
import type { ReportPeriod } from './types.js';

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export class InvalidPeriodError extends Error {
  constructor(message: string) {
    super(message);
  }
}

interface RawPeriodInput {
  month?: string;
  year?: string;
  startDate?: string;
  endDate?: string;
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function formatDateId(d: Date): string {
  return `${d.getUTCDate()} ${MONTH_NAMES_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function parsePeriod(input: RawPeriodInput): ReportPeriod {
  // Custom range takes precedence.
  if (input.startDate || input.endDate) {
    if (!input.startDate || !input.endDate) {
      throw new InvalidPeriodError('startDate and endDate must both be provided');
    }
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new InvalidPeriodError('invalid startDate/endDate');
    }
    if (start > end) {
      throw new InvalidPeriodError('startDate must be on or before endDate');
    }
    const startUtc = utcMidnight(start);
    const endUtc = endOfDayUtc(end);
    return {
      startDate: startUtc,
      endDate: endUtc,
      label: `${formatDateId(startUtc)} – ${formatDateId(endUtc)}`,
      periodMonth: new Date(Date.UTC(startUtc.getUTCFullYear(), startUtc.getUTCMonth(), 1)),
    };
  }

  // Calendar month.
  const month = Number(input.month);
  const year = Number(input.year);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new InvalidPeriodError('month must be 1..12');
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new InvalidPeriodError('year must be 2000..2100');
  }
  const startUtc = new Date(Date.UTC(year, month - 1, 1));
  const endUtc = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return {
    startDate: startUtc,
    endDate: endUtc,
    label: `${MONTH_NAMES_ID[month - 1]} ${year}`,
    periodMonth: startUtc,
  };
}

export function parseComparePeriod(input: {
  compareMonth?: string;
  compareYear?: string;
  compareStartDate?: string;
  compareEndDate?: string;
}): ReportPeriod | undefined {
  const has =
    input.compareMonth || input.compareYear || input.compareStartDate || input.compareEndDate;
  if (!has) return undefined;
  return parsePeriod({
    month: input.compareMonth,
    year: input.compareYear,
    startDate: input.compareStartDate,
    endDate: input.compareEndDate,
  });
}
