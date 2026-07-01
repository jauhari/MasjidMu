/**
 * Funds service — provisioning the per-tenant Dana list.
 *
 * Operates within an already-tenant-scoped tx (RLS context set by caller).
 *
 * Editions:
 *   - All tenants get GENERAL_FUND ('umum').
 *   - ZakatMu (OPZ) tenants additionally get the four PSAK 109 funds.
 *   - Nazhir wakaf tenants additionally get the PSAK 112 wakaf fund.
 *
 * Idempotent by (tenant_id, code): re-running skips funds that already exist
 * and restores soft-deleted system funds.
 */
import { eq } from 'drizzle-orm';
import type { Tx } from '../../../db/client.js';
import { funds } from '../../../db/schema/accounting.js';
import {
  type DefaultFundSpec,
  GENERAL_FUND,
  PSAK_109_DEFAULT_FUNDS,
  PSAK_112_WAKAF_FUND,
} from './defaults.js';

export interface SeedFundsOptions {
  /** Seed the four PSAK 109 funds (ZakatMu / OPZ edition). */
  withZakat?: boolean;
  /** Seed the PSAK 112 wakaf fund (nazhir edition). */
  withWakaf?: boolean;
}

export type TenantEdition = 'masjid' | 'laz' | 'pesantren' | 'yayasan';

/**
 * Map edisi lembaga → dana yang harus di-seed.
 * Hanya LAZ (OPZ) yang butuh dimensi dana PSAK 109; edisi lain pakai ISAK 35
 * (klasifikasi aset neto di COA) tanpa dimensi dana → kembalikan null sehingga
 * selektor dana tetap tersembunyi & perilaku lama tak berubah.
 */
export function fundSeedOptionsForEdition(edition: TenantEdition): SeedFundsOptions | null {
  switch (edition) {
    case 'laz':
      return { withZakat: true };
    case 'masjid':
    case 'pesantren':
    case 'yayasan':
      return null;
  }
}

/** Returns the count of NEW funds inserted. */
export async function seedFunds(
  tenantId: string,
  opts: SeedFundsOptions,
  db: Tx,
): Promise<number> {
  const specs: DefaultFundSpec[] = [GENERAL_FUND];
  if (opts.withZakat) specs.push(...PSAK_109_DEFAULT_FUNDS);
  if (opts.withWakaf) specs.push(PSAK_112_WAKAF_FUND);

  const existing = await db
    .select({ id: funds.id, code: funds.code, deletedAt: funds.deletedAt })
    .from(funds)
    .where(eq(funds.tenantId, tenantId));
  const existingByCode = new Map(existing.map((f) => [f.code, f]));

  let inserted = 0;
  for (const spec of specs) {
    const ex = existingByCode.get(spec.code);
    if (ex) {
      if (ex.deletedAt !== null) {
        await db
          .update(funds)
          .set({
            deletedAt: null,
            isActive: true,
            name: spec.name,
            fundType: spec.fundType,
            isRestricted: spec.isRestricted,
            isSystem: spec.isSystem ?? false,
            description: spec.description ?? null,
            sortOrder: spec.sortOrder,
            updatedAt: new Date(),
          })
          .where(eq(funds.id, ex.id));
      }
      continue;
    }
    await db.insert(funds).values({
      tenantId,
      code: spec.code,
      name: spec.name,
      fundType: spec.fundType,
      isRestricted: spec.isRestricted,
      isSystem: spec.isSystem ?? false,
      description: spec.description ?? null,
      sortOrder: spec.sortOrder,
    });
    inserted++;
  }

  return inserted;
}
