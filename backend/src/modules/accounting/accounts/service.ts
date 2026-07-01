/**
 * Accounts service — provisioning & lookups for the Chart of Accounts.
 *
 * Higher-level concerns (auth, RLS context) are handled by route middleware;
 * this module operates within an already-tenant-scoped tx.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from '../../../db/client.js';
import { withTenant } from '../../../db/client.js';
import { accounts } from '../../../db/schema/accounting.js';
import {
  PSAK_45_DEFAULT_ACCOUNTS,
  defaultNormalBalance,
  deriveParentCode,
} from './defaults.js';

/**
 * Seed the PSAK 45 default chart of accounts for a freshly-created tenant.
 *
 * Idempotent in two senses:
 *   1. Re-running on a tenant that already has accounts skips duplicates.
 *   2. EVERY run re-derives parent_id linkage for ALL default-chart codes,
 *      so a re-seed acts as a "repair" pass if anything got out of sync.
 *
 * Pass an existing transaction to inline this seed inside tenant creation.
 * Otherwise we open our own (tenant-scoped) tx.
 *
 * Returns the count of NEW accounts inserted (0 means everything already
 * existed; parent linkage may still have been corrected).
 */
export async function seedDefaultChart(tenantId: string, tx?: Tx): Promise<number> {
  const inner = async (db: Tx) => {
    // Look up ALL existing rows incl. soft-deleted, since the
    // (tenant_id, code) unique constraint is enforced across all rows.
    const existing = await db
      .select({ id: accounts.id, code: accounts.code, deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(eq(accounts.tenantId, tenantId));
    const existingByCode = new Map(existing.map((a) => [a.code, a]));

    // Pass 1: insert any genuinely missing codes; restore soft-deleted ones.
    let insertedCount = 0;
    let restoredCount = 0;
    for (const spec of PSAK_45_DEFAULT_ACCOUNTS) {
      const ex = existingByCode.get(spec.code);
      if (ex) {
        if (ex.deletedAt !== null) {
          await db
            .update(accounts)
            .set({
              deletedAt: null,
              isActive: true,
              name: spec.name,
              accountType: spec.accountType,
              normalBalance: spec.normalBalance ?? defaultNormalBalance(spec.accountType),
              isSystem: spec.isSystem ?? false,
              updatedAt: new Date(),
            })
            .where(eq(accounts.id, ex.id));
          restoredCount++;
        }
        continue;
      }
      await db.insert(accounts).values({
        tenantId,
        code: spec.code,
        name: spec.name,
        accountType: spec.accountType,
        normalBalance: spec.normalBalance ?? defaultNormalBalance(spec.accountType),
        isSystem: spec.isSystem ?? false,
      });
      insertedCount++;
    }

    // Pass 2: re-derive parent linkage for every 4-digit account code.
    // Covers sheet-imported COA rows as well as the default PSAK 45 chart.
    const all = await db
      .select({ id: accounts.id, code: accounts.code, parentId: accounts.parentId })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)));
    const idByCode = new Map(all.map((a) => [a.code, a.id]));

    for (const row of all) {
      const parentCode = deriveParentCode(row.code);
      const expectedParentId = parentCode ? idByCode.get(parentCode) ?? null : null;
      if (row.parentId !== expectedParentId) {
        await db
          .update(accounts)
          .set({ parentId: expectedParentId, updatedAt: new Date() })
          .where(eq(accounts.id, row.id));
      }
    }

    return insertedCount + restoredCount;
  };

  if (tx) return inner(tx);
  return withTenant(tenantId, inner);
}
