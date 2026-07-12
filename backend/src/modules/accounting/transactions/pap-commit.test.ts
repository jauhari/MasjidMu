import { describe, expect, it } from 'vitest';
import { buildPAPAccountingLines, canonicalPAPPayloadFingerprint, papCommitSchema } from './pap-import.js';

const base = {
  sourceFingerprint: 'a'.repeat(64),
  sourceType: 'excel' as const,
  reason: 'Import PAP Juli 2026',
  cashAccountId: '11111111-1111-4111-8111-111111111111',
  incomeAccountId: '22222222-2222-4222-8222-222222222222',
  expenseAccountId: '33333333-3333-4333-8333-333333333333',
  fundId: '44444444-4444-4444-8444-444444444444',
  rows: [{ date: '2026-07-01', description: 'Infak', referenceNo: 'P-1', direction: 'income' as const, amount: '1000' }],
};

describe('PAP commit helpers', () => {
  it('builds balanced income and expense lines with the selected fund', () => {
    expect(buildPAPAccountingLines(base.rows[0], base)).toEqual([
      expect.objectContaining({ accountId: base.cashAccountId, fundId: base.fundId, debit: '1000.00', credit: '0.00' }),
      expect.objectContaining({ accountId: base.incomeAccountId, fundId: base.fundId, debit: '0.00', credit: '1000.00' }),
    ]);
    expect(buildPAPAccountingLines({ ...base.rows[0], direction: 'expense' }, base)).toEqual([
      expect.objectContaining({ accountId: base.expenseAccountId, fundId: base.fundId, debit: '1000.00', credit: '0.00' }),
      expect.objectContaining({ accountId: base.cashAccountId, fundId: base.fundId, debit: '0.00', credit: '1000.00' }),
    ]);
  });

  it('uses an expense override only for expense rows', () => {
    const override = '55555555-5555-4555-8555-555555555555';
    const [expenseLine] = buildPAPAccountingLines({
      ...base.rows[0], direction: 'expense', expenseAccountId: override,
    }, base);
    expect(expenseLine).toMatchObject({ accountId: override, debit: '1000.00', credit: '0.00' });
  });

  it('validates commit contracts and fingerprints canonical money', () => {
    expect(papCommitSchema.safeParse(base).success).toBe(true);
    expect(canonicalPAPPayloadFingerprint(base)).toBe(
      canonicalPAPPayloadFingerprint({ ...base, rows: [{ ...base.rows[0], amount: '1000.00' }] }),
    );
    expect(papCommitSchema.safeParse({ ...base, rows: [{ ...base.rows[0], date: '01/07/2026' }] }).success).toBe(false);
    const withoutSourceType = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== 'sourceType'),
    );
    expect(papCommitSchema.safeParse(withoutSourceType).success).toBe(false);
  });
});
