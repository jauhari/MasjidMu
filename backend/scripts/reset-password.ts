/**
 * Reset better-auth credential password for a user (dev/admin recovery).
 *
 * Run:
 *   pnpm tsx scripts/reset-password.ts --email=admin@masjidmu.id --password='MasjidMu@dev123'
 */
import { hashPassword } from 'better-auth/crypto';
import { sql } from 'drizzle-orm';
import { asSuperAdmin, pool } from '../src/db/client.js';

function parseArgs(argv: string[]): { email: string; password: string } {
  const get = (key: string) => {
    const arg = argv.find((a) => a.startsWith(`--${key}=`));
    if (!arg) throw new Error(`Missing --${key}`);
    return arg.split('=').slice(1).join('=');
  };
  const email = get('email');
  const password = get('password');
  if (password.length < 8) throw new Error('Password must be ≥ 8 chars');
  return { email, password };
}

async function main() {
  const { email, password } = parseArgs(process.argv.slice(2));
  const hashed = await hashPassword(password);

  const updated = await asSuperAdmin(async (tx) => {
    const r = await tx.execute<{ id: string }>(sql`
      UPDATE account a
      SET password = ${hashed}, updated_at = NOW()
      FROM "user" u
      WHERE a.user_id = u.id
        AND u.email = ${email}
        AND a.provider_id = 'credential'
      RETURNING a.id
    `);
    return r.rows.length;
  });

  if (updated === 0) {
    throw new Error(`No credential account found for ${email}`);
  }

  console.log(`✅ Password reset for ${email}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ Reset failed:', e);
  await pool.end();
  process.exit(1);
});