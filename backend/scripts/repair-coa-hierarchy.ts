/**
 * Repair parent_id linkage for all 4-digit account codes in a tenant.
 * Idempotent — safe to re-run after sheet imports.
 *
 * Run: pnpm tsx scripts/repair-coa-hierarchy.ts [--tenant=admin]
 */
import { sql } from 'drizzle-orm';
import { asSuperAdmin, pool } from '../src/db/client.js';
import { seedDefaultChart } from '../src/modules/accounting/accounts/service.js';

async function main() {
  const slug = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1] ?? 'admin';
  const r = await asSuperAdmin((tx) =>
    tx.execute(sql`SELECT id FROM tenants WHERE slug = ${slug} LIMIT 1`),
  );
  if (r.rows.length === 0) throw new Error(`tenant "${slug}" not found`);
  const tenantId = (r.rows[0] as { id: string }).id;

  const inserted = await seedDefaultChart(tenantId);
  console.log(`✅ COA repair complete for tenant "${slug}" (new inserts: ${inserted})`);
  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ Repair failed:', e);
  await pool.end();
  process.exit(1);
});