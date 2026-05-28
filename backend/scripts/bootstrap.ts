/**
 * Bootstrap script: create the platform's first tenant and first super_admin.
 *
 * Run ONCE per Neon DB after `db:seed`. Idempotent: if `--slug` already
 * exists, refreshes the assignment instead of duplicating.
 *
 * Run:
 *   pnpm tsx scripts/bootstrap.ts \
 *     --slug=admin \
 *     --tenant-name="MasjidMu Platform" \
 *     --email=admin@masjidmu.id \
 *     --password=<min 12 chars> \
 *     --name="Platform Admin"
 *
 * What it does:
 *   1. Create a tenant (slug=admin) acting as the super-admin's home tenant
 *   2. Sign up a better-auth user with the given credentials
 *   3. Insert a `users` row mapping authUserId → tenant
 *   4. Grant the system `super_admin` role to that user
 */
import { and, eq, isNull } from 'drizzle-orm';
import { asSuperAdmin, pool } from '../src/db/client.js';
import { roles, tenants, userRoles } from '../src/db/schema/core.js';
import { auth } from '../src/lib/auth.js';
import { ensureUserMapping } from '../src/lib/user-mapping.js';

interface Args {
  slug: string;
  tenantName: string;
  email: string;
  password: string;
  name: string;
}

function parseArgs(argv: string[]): Args {
  const get = (key: string) => {
    const arg = argv.find((a) => a.startsWith(`--${key}=`));
    if (!arg) throw new Error(`Missing --${key}`);
    return arg.split('=').slice(1).join('=');
  };

  const a: Args = {
    slug: get('slug'),
    tenantName: get('tenant-name'),
    email: get('email'),
    password: get('password'),
    name: get('name'),
  };

  if (a.password.length < 12) throw new Error('Password must be ≥ 12 chars');
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(a.slug)) throw new Error('Invalid slug');

  return a;
}

async function main() {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error('Error:', (e as Error).message);
    console.error('Usage: pnpm tsx scripts/bootstrap.ts --slug=admin --tenant-name="X" --email=a@b.id --password=... --name="..."');
    process.exit(1);
  }

  console.log('1. Create or fetch tenant...');
  const tenant = await asSuperAdmin(async (tx) => {
    const existing = await tx.select().from(tenants).where(eq(tenants.slug, args.slug));
    if (existing[0]) {
      console.log(`   • tenant ${args.slug} already exists`);
      return existing[0];
    }
    const [t] = await tx.insert(tenants).values({ slug: args.slug, name: args.tenantName }).returning();
    console.log(`   ✓ created tenant ${args.slug}`);
    return t!;
  });

  console.log('2. Sign up via better-auth (or fetch existing)...');
  let authUserId: string;
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: args.email,
        password: args.password,
        name: args.name,
      },
    });
    authUserId = result.user.id;
    console.log(`   ✓ signed up: ${authUserId}`);
  } catch (e) {
    // Email already exists — fetch the existing one
    const msg = (e as Error).message;
    if (/already|exists|in use/i.test(msg)) {
      console.log(`   • email already registered, fetching auth user`);
      const found = await asSuperAdmin(async (tx) => {
        const r = await tx.execute<{ id: string }>(
          // raw query: better-auth's `user` table is text-id, not in our typed schema
          // (well, it is, but easier to query directly)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { sql: `SELECT id FROM "user" WHERE email = $1`, args: [args.email] } as any,
        );
        return r.rows[0]?.id;
      });
      if (!found) throw new Error('Email exists in auth but lookup failed');
      authUserId = found;
    } else {
      throw e;
    }
  }

  console.log('3. Map auth user to tenant...');
  const u = await ensureUserMapping(
    { id: authUserId, email: args.email, name: args.name },
    tenant.id,
  );
  console.log(`   ✓ users.id=${u.id}`);

  console.log('4. Grant super_admin role...');
  await asSuperAdmin(async (tx) => {
    const [systemRole] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.code, 'super_admin'), isNull(roles.tenantId)));
    if (!systemRole) throw new Error('super_admin system role missing — run db:seed first');

    const existing = await tx
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, u.id), eq(userRoles.roleId, systemRole.id)));
    if (existing[0]) {
      console.log('   • super_admin already granted');
    } else {
      await tx.insert(userRoles).values({ userId: u.id, roleId: systemRole.id });
      console.log('   ✓ granted super_admin');
    }
  });

  console.log('\n✅ Bootstrap complete.');
  console.log(`   Tenant slug: ${args.slug}`);
  console.log(`   Login:       ${args.email}`);
  console.log(`   Sign in via: POST /api/auth/sign-in/email`);
  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ Bootstrap failed:', e);
  await pool.end();
  process.exit(1);
});
