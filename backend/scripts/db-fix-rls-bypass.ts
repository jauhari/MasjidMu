/**
 * Revoke BYPASSRLS from the app role so that RLS policies actually apply.
 * Neon's `neondb_owner` defaults to BYPASSRLS=true — meaning RLS is enabled
 * but our app role ignores it. Run this once per Neon DB.
 *
 * Run: pnpm tsx scripts/db-fix-rls-bypass.ts
 */
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';

async function main() {
  const before = await db.execute(sql`
    SELECT current_user AS r, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `);
  console.log('Before:', before.rows[0]);

  // Use the role name from current_user to be safe across Neon DBs.
  await db.execute(sql.raw(`ALTER ROLE ${(before.rows[0] as { r: string }).r} NOBYPASSRLS`));

  const after = await db.execute(sql`
    SELECT current_user AS r, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `);
  console.log('After:', after.rows[0]);

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
