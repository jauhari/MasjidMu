/**
 * Journal balance trigger tests.
 *
 * The trigger lives in src/db/migrations/sql/040_triggers_journal_balance.sql
 * and enforces SUM(debit) = SUM(credit) per journal at COMMIT time.
 *
 * It's a CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED, so per-row
 * transient imbalance during multi-row inserts is OK — only the final
 * COMMIT-time state matters.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { asSuperAdmin, pool, withTenant } from './client.js';
import { tenants, users } from './schema/core.js';
import {
  accounts,
  journalLines,
  journals,
} from './schema/accounting.js';

const skipReal = !process.env.DATABASE_URL || process.env.DATABASE_URL.includes('placeholder');

describe.skipIf(skipReal)('Journal balance trigger', () => {
  let tenantId: string;
  let userId: string;
  let assetId: string;
  let incomeId: string;

  beforeAll(async () => {
    const t = await asSuperAdmin(async (tx) => {
      const [r] = await tx
        .insert(tenants)
        .values({ slug: `bal-${Date.now()}`, name: 'Balance Test' })
        .returning();
      return r!;
    });
    tenantId = t.id;

    const setup = await withTenant(tenantId, async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          tenantId,
          email: `bal-${Date.now()}@test.local`,
          name: 'Balance Tester',
          status: 'active',
        })
        .returning();
      const [aAsset] = await tx
        .insert(accounts)
        .values({
          tenantId,
          code: '1000',
          name: 'Kas',
          accountType: 'asset',
          normalBalance: 'debit',
        })
        .returning();
      const [aIncome] = await tx
        .insert(accounts)
        .values({
          tenantId,
          code: '4000',
          name: 'Pendapatan',
          accountType: 'income',
          normalBalance: 'credit',
        })
        .returning();
      return { u, aAsset, aIncome };
    });
    userId = setup.u.id;
    assetId = setup.aAsset.id;
    incomeId = setup.aIncome.id;
  });

  afterAll(async () => {
    // Order matters: journals → accounts/users → tenant. journal_lines.account_id
    // FK has no CASCADE, so we must drop journals (which cascades lines) first.
    await asSuperAdmin(async (tx) => {
      await tx.delete(journals).where(eq(journals.tenantId, tenantId));
      await tx.delete(tenants).where(eq(tenants.id, tenantId));
    });
    await pool.end();
  });

  it('rejects unbalanced journal at COMMIT', async () => {
    await expect(
      withTenant(tenantId, async (tx) => {
        const [j] = await tx
          .insert(journals)
          .values({
            tenantId,
            journalNo: `J-UNBAL-${Date.now()}`,
            journalDate: new Date(),
            createdBy: userId,
            description: 'unbalanced',
          })
          .returning();
        await tx.insert(journalLines).values([
          { journalId: j!.id, accountId: assetId, debit: '1000', credit: '0' },
          // Credit only 500 — unbalanced
          { journalId: j!.id, accountId: incomeId, debit: '0', credit: '500' },
        ]);
      }),
    ).rejects.toThrow(/unbalanced/i);
  });

  it('accepts balanced journal', async () => {
    const result = await withTenant(tenantId, async (tx) => {
      const [j] = await tx
        .insert(journals)
        .values({
          tenantId,
          journalNo: `J-BAL-${Date.now()}`,
          journalDate: new Date(),
          createdBy: userId,
          description: 'balanced',
        })
        .returning();
      await tx.insert(journalLines).values([
        { journalId: j!.id, accountId: assetId, debit: '1000', credit: '0' },
        { journalId: j!.id, accountId: incomeId, debit: '0', credit: '1000' },
      ]);
      return j!;
    });
    expect(result.id).toBeDefined();
  });

  it('rejects line with both debit and credit > 0 (CHECK constraint)', async () => {
    await expect(
      withTenant(tenantId, async (tx) => {
        const [j] = await tx
          .insert(journals)
          .values({
            tenantId,
            journalNo: `J-XOR-${Date.now()}`,
            journalDate: new Date(),
            createdBy: userId,
          })
          .returning();
        await tx.insert(journalLines).values([
          { journalId: j!.id, accountId: assetId, debit: '500', credit: '500' },
        ]);
      }),
    ).rejects.toThrow(/check|debit_xor_credit|violates/i);
  });

  it('rejects negative debit (CHECK constraint)', async () => {
    await expect(
      withTenant(tenantId, async (tx) => {
        const [j] = await tx
          .insert(journals)
          .values({
            tenantId,
            journalNo: `J-NEG-${Date.now()}`,
            journalDate: new Date(),
            createdBy: userId,
          })
          .returning();
        await tx.insert(journalLines).values([
          { journalId: j!.id, accountId: assetId, debit: '-100', credit: '0' },
        ]);
      }),
    ).rejects.toThrow(/check|non_neg|violates/i);
  });
});
