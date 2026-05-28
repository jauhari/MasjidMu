import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { env } from '../lib/env.js';
import * as core from './schema/core.js';
import * as accounting from './schema/accounting.js';
import * as organization from './schema/organization.js';
import * as content from './schema/content.js';
import * as audit from './schema/audit.js';
import * as auth from './schema/auth.js';

const schema = { ...core, ...accounting, ...organization, ...content, ...audit, ...auth };

const { Pool } = pg;

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema, casing: 'snake_case' });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type TenantRole = 'super_admin' | 'user';

/**
 * Run a function within a tenant-scoped transaction.
 *
 * Sets `app.current_tenant_id` (and optionally `app.current_user_role`) so
 * Postgres RLS policies filter rows correctly. RLS is the primary defense;
 * any code path that touches tenant-scoped tables MUST go through this helper.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  opts: { role?: TenantRole } = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
    if (opts.role) {
      await tx.execute(sql`SELECT set_config('app.current_user_role', ${opts.role}, true)`);
    }
    return fn(tx);
  });
}

/** Internal helper for super_admin operations across all tenants. Use sparingly. */
export async function asSuperAdmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_role', 'super_admin', true)`);
    return fn(tx);
  });
}

export { pool };
