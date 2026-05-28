/**
 * Create the `masjidmu_app` role used by the application at runtime.
 * This role has NO BYPASSRLS so policies actually apply. The Neon-provided
 * `neondb_owner` (with BYPASSRLS) is reserved for migrations and admin tasks.
 *
 * Idempotent: safe to re-run.
 *
 * Run: pnpm tsx scripts/db-create-app-role.ts <password>
 *
 * Uses DATABASE_URL_OWNER (owner role) since CREATE/ALTER ROLE and GRANT
 * need owner privileges.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import 'dotenv/config';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

async function main() {
  const password = process.argv[2];
  if (!password || password.length < 16) {
    console.error('Usage: db-create-app-role.ts <password (>= 16 chars)>');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_OWNER or DATABASE_URL required');

  const pool = new pg.Pool({
    connectionString: url,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  const db = drizzle(pool);

  console.log('1. Create role masjidmu_app (NOBYPASSRLS, NOSUPERUSER)...');
  await db.execute(sql.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'masjidmu_app') THEN
        CREATE ROLE masjidmu_app WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}'
          NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE masjidmu_app WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}';
      END IF;
    END $$;
  `));

  console.log('2. Grant schema + table privileges...');
  await db.execute(sql`GRANT USAGE ON SCHEMA public TO masjidmu_app`);
  await db.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO masjidmu_app`);
  await db.execute(sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO masjidmu_app`);
  await db.execute(sql`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO masjidmu_app`);

  // Default privileges for future tables created by neondb_owner
  await db.execute(sql`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO masjidmu_app
  `);
  await db.execute(sql`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO masjidmu_app
  `);

  console.log('3. Verify role attributes...');
  const r = await db.execute(sql`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'masjidmu_app'
  `);
  console.log('   ', r.rows[0]);

  console.log('\n✅ masjidmu_app ready.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
