/**
 * Critical RLS isolation tests.
 *
 * These verify the *primary* tenant isolation defense: Postgres RLS policies.
 * If any of these fail, ANY data leak fix in app code is meaningless — the
 * DB itself isn't enforcing isolation.
 *
 * Set ALLOW_DESTRUCTIVE_TESTS=yes to run; tests insert/cleanup their own rows
 * but require a working Neon connection.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { asSuperAdmin, db, pool, withTenant } from './client.js';
import { tenants } from './schema/core.js';
import { accounts } from './schema/accounting.js';

const skipReal = !process.env.DATABASE_URL || process.env.DATABASE_URL.includes('placeholder');

describe.skipIf(skipReal)('RLS isolation', () => {
  let tenantAId: string;
  let tenantBId: string;
  let accountAId: string;

  beforeAll(async () => {
    // super_admin bypass needed to insert tenants/accounts during setup
    const tA = await asSuperAdmin(async (tx) => {
      const [r] = await tx
        .insert(tenants)
        .values({ slug: `rls-a-${Date.now()}`, name: 'RLS Test A' })
        .returning();
      return r!;
    });
    const tB = await asSuperAdmin(async (tx) => {
      const [r] = await tx
        .insert(tenants)
        .values({ slug: `rls-b-${Date.now()}`, name: 'RLS Test B' })
        .returning();
      return r!;
    });
    tenantAId = tA.id;
    tenantBId = tB.id;

    // Insert account in tenant A using its own context
    accountAId = await withTenant(tenantAId, async (tx) => {
      const [a] = await tx
        .insert(accounts)
        .values({
          tenantId: tenantAId,
          code: '1000',
          name: 'Kas',
          accountType: 'asset',
          normalBalance: 'debit',
        })
        .returning();
      return a!.id;
    });
  });

  afterAll(async () => {
    // Cleanup via super_admin
    await asSuperAdmin(async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, tenantAId));
      await tx.delete(tenants).where(eq(tenants.id, tenantBId));
    });
    await pool.end();
  });

  it('CRITICAL: tenant B cannot SELECT tenant A accounts', async () => {
    const result = await withTenant(tenantBId, async (tx) =>
      tx.select().from(accounts),
    );
    expect(result.find((r) => r.id === accountAId)).toBeUndefined();
  });

  it('CRITICAL: tenant B cannot findById tenant A account', async () => {
    const result = await withTenant(tenantBId, async (tx) =>
      tx.select().from(accounts).where(eq(accounts.id, accountAId)),
    );
    expect(result).toHaveLength(0);
  });

  it('CRITICAL: tenant B UPDATE on tenant A account affects 0 rows', async () => {
    const updated = await withTenant(tenantBId, async (tx) =>
      tx
        .update(accounts)
        .set({ name: 'HACKED' })
        .where(eq(accounts.id, accountAId))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    // Verify from tenant A: name unchanged
    const verify = await withTenant(tenantAId, async (tx) =>
      tx.select().from(accounts).where(eq(accounts.id, accountAId)),
    );
    expect(verify[0]?.name).toBe('Kas');
  });

  it('CRITICAL: tenant B INSERT with tenant_id=A is rejected (WITH CHECK)', async () => {
    await expect(
      withTenant(tenantBId, async (tx) =>
        tx.insert(accounts).values({
          tenantId: tenantAId, // ← attempt to write into tenant A
          code: '9999',
          name: 'Hack',
          accountType: 'asset',
          normalBalance: 'debit',
        }),
      ),
    ).rejects.toThrow();
  });

  it('CRITICAL: super_admin can SEE accounts across tenants', async () => {
    const result = await asSuperAdmin(async (tx) => tx.select().from(accounts));
    expect(result.find((r) => r.id === accountAId)).toBeDefined();
  });

  it('default deny: query without context returns empty', async () => {
    // No withTenant wrapper — context is empty
    const result = await db.select().from(accounts).where(eq(accounts.id, accountAId));
    expect(result).toHaveLength(0);
  });

  it('GUC isolation: SET LOCAL inside withTenant does not leak across calls', async () => {
    // First call sets tenant A context
    await withTenant(tenantAId, async (tx) => {
      const r = await tx.execute(sql`SELECT current_setting('app.current_tenant_id', true) AS ctx`);
      expect((r.rows[0] as { ctx: string }).ctx).toBe(tenantAId);
    });

    // Second call: separate transaction, should NOT see A's setting
    const result = await db.execute(
      sql`SELECT current_setting('app.current_tenant_id', true) AS ctx`,
    );
    // Context resets between transactions (SET LOCAL semantics)
    expect((result.rows[0] as { ctx: string }).ctx).toBe('');
  });
});
