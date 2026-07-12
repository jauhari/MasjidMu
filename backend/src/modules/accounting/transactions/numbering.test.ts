import { describe, expect, it } from 'vitest';
import { accountingNumberPattern, accountingNumberPrefix, nextAccountingSequence } from './numbering.js';

describe('accounting numbering', () => {
  it('builds deterministic monthly prefixes', () => {
    expect(accountingNumberPrefix('al')).toBe('ALXX');
    expect(accountingNumberPattern('transaction', 'masjid-agung', new Date('2026-07-01T00:00:00Z'))).toEqual({
      prefix: 'TX-MASJ-202607-',
      like: 'TX-MASJ-202607-%',
    });
  });

  it('increments without wrapping four-digit sequences', () => {
    expect(nextAccountingSequence(null)).toBe(1);
    expect(nextAccountingSequence('JRN-MASJ-202607-0042')).toBe(43);
    expect(nextAccountingSequence('TX-MASJ-202607-9999')).toBe(10000);
    expect(nextAccountingSequence('invalid')).toBe(1);
  });
});
