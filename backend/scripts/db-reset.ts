/**
 * Drops all objects in the public schema. DESTRUCTIVE — only for dev/Neon
 * resets when iterating on schema. Never run against production.
 *
 * Uses DATABASE_URL_OWNER (owner role) since DROP SCHEMA needs owner
 * privileges. masjidmu_app is intentionally non-privileged.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import 'dotenv/config';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

async function main() {
  if (process.env.ALLOW_RESET !== 'yes') {
    console.error('Refusing to reset. Set ALLOW_RESET=yes to confirm.');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_OWNER or DATABASE_URL required');

  const pool = new pg.Pool({
    connectionString: url,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  const db = drizzle(pool);

  console.log('Resetting public schema (as owner)...');
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  // Owner already has all; grant back to public for default behaviour.
  await db.execute(sql`GRANT ALL ON SCHEMA public TO public`);
  console.log('✓ Done.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
