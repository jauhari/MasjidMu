import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';

async function main() {
  const result = await db.execute(sql`
    SELECT current_user, rolname,
           rolsuper, rolbypassrls, rolinherit
      FROM pg_roles
     WHERE rolname = current_user
  `);
  console.log(JSON.stringify(result.rows, null, 2));
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
