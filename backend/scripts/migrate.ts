/**
 * Migration runner.
 *
 * Order of execution:
 *   1. Drizzle migrations (auto-generated DDL from schema diff)
 *   2. Raw SQL companion files in `src/db/migrations/sql/` (alphabetical)
 *
 * Companions handle Postgres features Drizzle doesn't model: RLS policies,
 * partman setup, generated tsvector columns, custom triggers.
 *
 * Re-runnable: companion SQL files MUST use `IF NOT EXISTS` / `CREATE OR REPLACE`
 * patterns. They are applied on every run.
 */
import 'dotenv/config';
import { config } from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

config({ path: '.env.local' });
config({ path: '.env' });

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  // Migrations need DDL/owner privileges — use DATABASE_URL_OWNER if set,
  // fall back to DATABASE_URL for environments where they're the same role.
  const url = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ Neither DATABASE_URL_OWNER nor DATABASE_URL set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log('1. Running Drizzle migrations...');
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: join(__dirname, '../src/db/migrations/meta') });
    console.log('   ✓ Drizzle migrations applied');

    console.log('2. Running raw SQL companions...');
    const sqlDir = join(__dirname, '../src/db/migrations/sql');
    let files: string[] = [];
    try {
      files = (await readdir(sqlDir)).filter((f) => f.endsWith('.sql')).sort();
    } catch (e) {
      console.log('   (no sql/ directory — skipping)');
    }

    for (const f of files) {
      console.log(`   → ${f}`);
      const sql = await readFile(join(sqlDir, f), 'utf-8');
      await pool.query(sql);
    }

    console.log('✓ Done.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('❌ Migration failed:', e);
  process.exit(1);
});
