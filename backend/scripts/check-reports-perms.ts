import { asSuperAdmin, pool } from '../src/db/client.js';
import { sql } from 'drizzle-orm';

const r = await asSuperAdmin(async (tx) =>
  tx.execute(sql`SELECT code FROM permissions WHERE code LIKE 'reports.%' ORDER BY code`)
);
console.log(r.rows);
await pool.end();
