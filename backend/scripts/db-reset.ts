/**
 * Drops all objects in the public schema. DESTRUCTIVE — only for dev/Neon
 * resets when iterating on schema. Never run against production.
 */
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';

async function main() {
  if (process.env.ALLOW_RESET !== 'yes') {
    console.error('Refusing to reset. Set ALLOW_RESET=yes to confirm.');
    process.exit(1);
  }

  console.log('Resetting public schema...');
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`GRANT ALL ON SCHEMA public TO neondb_owner`);
  await db.execute(sql`GRANT ALL ON SCHEMA public TO public`);
  console.log('✓ Done.');
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
