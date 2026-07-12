import { describe, expect, it } from 'vitest';
import { normalizeImportedAmount, normalizeImportedDate } from './import-normalization.js';

describe('normalizeImportedAmount', () => {
  it.each([
    ['1.000', '1000.00'],
    ['1.000.000', '1000000.00'],
    ['1.000.000,50', '1000000.50'],
    ['Rp 1.250.000', '1250000.00'],
    ['US 1,000,000.50', '1000000.50'],
    [1250.5, '1250.50'],
    [{ formula: 'SUM(A1:A2)', result: 1500 }, '1500.00'],
  ])('normalizes %j', (input, expected) => {
    expect(normalizeImportedAmount(input)).toEqual({ ok: true, value: expected, empty: false });
  });

  it.each(['1.00.000', '1,234.567', 'abc', -1, { formula: 'SUM(A1:A2)' }])(
    'rejects invalid or negative input %j',
    (input) => {
      const result = normalizeImportedAmount(input);
      expect(result.ok).toBe(false);
    },
  );

  it.each([null, undefined, '', ' - '])('marks empty values without disguising invalid values', (input) => {
    expect(normalizeImportedAmount(input)).toEqual({ ok: true, value: '0.00', empty: true });
  });
});

describe('normalizeImportedDate', () => {
  it.each([
    ['1/2/2026', '2026-02-01'],
    ['01-02-26', '2026-02-01'],
    ['2026-02-01', '2026-02-01'],
    [new Date(Date.UTC(2026, 1, 1, 12)), '2026-02-01'],
    [46054, '2026-02-01'],
    [{ formula: 'TODAY()', result: new Date(Date.UTC(2026, 1, 1)) }, '2026-02-01'],
  ])('normalizes %j', (input, expected) => {
    expect(normalizeImportedDate(input)).toEqual({ ok: true, value: expected, empty: false });
  });

  it.each(['31/02/2026', '2026-02-31', '02/31/2026', 'tomorrow', -1])('strictly rejects %j', (input) => {
    expect(normalizeImportedDate(input).ok).toBe(false);
  });
});
