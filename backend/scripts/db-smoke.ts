/**
 * Smoke test: verify connection to Neon, that `tenants` table exists,
 * and that `withTenant` helper works (sets the right session var).
 *
 * Run: pnpm tsx scripts/db-smoke.ts
 */
import { sql } from 'drizzle-orm';
import { db, withTenant, asSuperAdmin, pool } from '../src/db/client.js';
import { tenants } from '../src/db/schema/core.js';

async function main() {
  console.log('1. Pinging DB...');
  const ping = await db.execute(sql`SELECT 1 AS ok`);
  console.log('   ✓ ping:', ping.rows);

  console.log('2. Verifying `tenants` table exists...');
  const tableCheck = await db.execute(sql`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenants'
     ORDER BY ordinal_position
  `);
  console.log(`   ✓ ${tableCheck.rows.length} columns:`, tableCheck.rows.map((r) => r.column_name).join(', '));

  console.log('3. Insert + select a smoke-test tenant (no RLS yet, normal insert)...');
  const inserted = await db
    .insert(tenants)
    .values({ slug: `smoke-${Date.now()}`, name: 'Smoke Test Tenant' })
    .onConflictDoNothing()
    .returning();
  console.log('   ✓ inserted:', inserted[0]?.slug);
  const tenantId = inserted[0]!.id;

  console.log('4. Round-trip: withTenant() sets app.current_tenant_id...');
  const ctxCheck = await withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`SELECT current_setting('app.current_tenant_id', true) AS ctx`);
    return r.rows[0];
  });
  console.log('   ✓ context:', ctxCheck);
  if ((ctxCheck as { ctx: string }).ctx !== tenantId) {
    throw new Error(`Expected ${tenantId}, got ${(ctxCheck as { ctx: string }).ctx}`);
  }

  console.log('5. asSuperAdmin() sets app.current_user_role...');
  const roleCheck = await asSuperAdmin(async (tx) => {
    const r = await tx.execute(sql`SELECT current_setting('app.current_user_role', true) AS role`);
    return r.rows[0];
  });
  console.log('   ✓ role:', roleCheck);

  console.log('6. Cleanup smoke test row...');
  await db.delete(tenants).where(sql`id = ${tenantId}`);
  console.log('   ✓ deleted');

  console.log('\n✅ DB smoke test PASSED');
  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ Smoke test failed:', e);
  await pool.end();
  process.exit(1);
});
