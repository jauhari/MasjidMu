import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';

async function main() {
  const result = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log(`✓ ${result.rows.length} tables in public schema:`);
  for (const row of result.rows) {
    console.log(`   • ${row.table_name as string}`);
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
