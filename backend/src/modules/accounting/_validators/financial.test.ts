/**
 * FinancialValidator unit tests.
 *
 * No DB needed — pure logic.
 */
import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { validateJournalEntries } from './financial.js';

describe('validateJournalEntries', () => {
  it('accepts a balanced two-line journal', () => {
    const r = validateJournalEntries([
      { debit: '1000', credit: '0', accountCode: 'KAS' },
      { debit: '0', credit: '1000', accountCode: 'INFAQ' },
    ]);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('accepts decimals (Rupiah doesn’t use sub-unit but the math should still hold)', () => {
    const r = validateJournalEntries([
      { debit: new Decimal('123456.78'), credit: 0 },
      { debit: 0, credit: new Decimal('123456.78') },
    ]);
    expect(r.valid).toBe(true);
  });

  it('rejects single-line', () => {
    const r = validateJournalEntries([{ debit: '1000', credit: '0' }]);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/at least 2/);
  });

  it('rejects unbalanced', () => {
    const r = validateJournalEntries([
      { debit: '1000', credit: '0' },
      { debit: '0', credit: '900' },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /Unbalanced/.test(e))).toBe(true);
  });

  it('rejects negative debit', () => {
    const r = validateJournalEntries([
      { debit: '-100', credit: '0', accountCode: 'KAS' },
      { debit: '0', credit: '-100' },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /KAS: debit cannot be negative/.test(e))).toBe(true);
  });

  it('rejects line with both debit and credit > 0', () => {
    const r = validateJournalEntries([
      { debit: '500', credit: '500', accountCode: 'X' },
      { debit: '0', credit: '0' },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /mutually exclusive/.test(e))).toBe(true);
  });

  it('rejects all-zero line', () => {
    const r = validateJournalEntries([
      { debit: '0', credit: '0', accountCode: 'X' },
      { debit: '100', credit: '0' },
      { debit: '0', credit: '100' },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /must be > 0/.test(e))).toBe(true);
  });

  it('handles n-line balanced split (3 debits → 1 credit)', () => {
    const r = validateJournalEntries([
      { debit: '300', credit: '0' },
      { debit: '500', credit: '0' },
      { debit: '200', credit: '0' },
      { debit: '0', credit: '1000' },
    ]);
    expect(r.valid).toBe(true);
  });

  it('1-rupiah imbalance is rejected (tolerance = 0)', () => {
    const r = validateJournalEntries([
      { debit: '1000.01', credit: '0' },
      { debit: '0', credit: '1000.00' },
    ]);
    expect(r.valid).toBe(false);
  });
});
