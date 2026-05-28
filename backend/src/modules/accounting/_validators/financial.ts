/**
 * FinancialValidator — pre-DB sanity checks for journal entries.
 *
 * Three layers of defense protect double-entry integrity:
 *   1. This validator (UX layer; informative error messages)
 *   2. Drizzle insert types (compile-time)
 *   3. Postgres CHECK constraints + balance trigger (final guarantee)
 *
 * IDR has no sub-unit, so tolerance is 0. If multi-currency lands later
 * (V2+), longer to 0.001 here AND in the DB trigger.
 *
 * Money is handled as Decimal to avoid float drift.
 */
import { Decimal } from 'decimal.js';

export interface JournalLineInput {
  accountCode?: string; // for error messages
  accountId?: string;
  debit: Decimal | string | number;
  credit: Decimal | string | number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const TOLERANCE = new Decimal(0);

function toDecimal(v: Decimal | string | number): Decimal {
  return v instanceof Decimal ? v : new Decimal(v);
}

export function validateJournalEntries(lines: JournalLineInput[]): ValidationResult {
  const errors: string[] = [];

  if (lines.length < 2) {
    errors.push('Journal must have at least 2 lines');
  }

  let sumDebit = new Decimal(0);
  let sumCredit = new Decimal(0);

  for (const [i, line] of lines.entries()) {
    const ref = line.accountCode ?? line.accountId ?? `line ${i + 1}`;
    const d = toDecimal(line.debit);
    const c = toDecimal(line.credit);

    if (d.isNegative()) errors.push(`${ref}: debit cannot be negative`);
    if (c.isNegative()) errors.push(`${ref}: credit cannot be negative`);

    if (d.isZero() && c.isZero()) {
      errors.push(`${ref}: debit or credit must be > 0`);
    }
    if (d.gt(0) && c.gt(0)) {
      errors.push(`${ref}: debit and credit are mutually exclusive`);
    }

    sumDebit = sumDebit.plus(d);
    sumCredit = sumCredit.plus(c);
  }

  const diff = sumDebit.minus(sumCredit).abs();
  if (diff.gt(TOLERANCE)) {
    errors.push(
      `Unbalanced: sum(debit)=${sumDebit.toFixed(2)} sum(credit)=${sumCredit.toFixed(2)} (diff=${diff.toFixed(2)})`,
    );
  }

  return { valid: errors.length === 0, errors };
}
