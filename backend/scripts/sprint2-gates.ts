/**
 * Sprint 2 acceptance gate runner.
 *
 * Verifies that the auth + tenant + permission stack is wired correctly
 * end-to-end before Sprint 3 (accounting) begins.
 *
 * Run: pnpm tsx scripts/sprint2-gates.ts
 *
 * Requires the dev server NOT running (script spawns its own auth checks).
 */
import { sql } from 'drizzle-orm';
import { asSuperAdmin, db, pool } from '../src/db/client.js';

type GateResult = { name: string; pass: boolean; detail: string };

async function gate1_authTablesPresent(): Promise<GateResult> {
  const expected = ['user', 'session', 'account', 'verification', 'organization', 'member', 'invitation'];
  const r = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('user', 'session', 'account', 'verification', 'organization', 'member', 'invitation')
  `);
  const found = new Set(r.rows.map((row) => row.table_name as string));
  const missing = expected.filter((t) => !found.has(t));
  return {
    name: 'better-auth tables present',
    pass: missing.length === 0,
    detail: missing.length === 0 ? `${expected.length} tables` : `MISSING: ${missing.join(', ')}`,
  };
}

async function gate2_bootstrapAdmin(): Promise<GateResult> {
  const r = await asSuperAdmin(async (tx) =>
    tx.execute(sql`
      SELECT u.id, u.email, u.tenant_id, t.slug
        FROM users u
        JOIN tenants t ON t.id = u.tenant_id
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'super_admin' AND r.tenant_id IS NULL
       LIMIT 1
    `),
  );
  return {
    name: 'Bootstrap super_admin exists',
    pass: r.rows.length === 1,
    detail: r.rows.length === 1
      ? `${(r.rows[0] as { email: string }).email} on tenant ${(r.rows[0] as { slug: string }).slug}`
      : 'No super_admin user found — run bootstrap script',
  };
}

async function gate3_authUserMappedToAppUser(): Promise<GateResult> {
  const r = await asSuperAdmin(async (tx) =>
    tx.execute(sql`
      SELECT au.id AS auth_id, u.auth_user_id, u.id AS app_id
        FROM "user" au
        LEFT JOIN users u ON u.auth_user_id = au.id
       WHERE u.id IS NOT NULL
       LIMIT 5
    `),
  );
  return {
    name: 'auth.user ↔ users mapping populated',
    pass: r.rows.length > 0,
    detail: `${r.rows.length} mapped pair(s)`,
  };
}

async function gate4_redisAvailable(): Promise<GateResult> {
  try {
    const { redis } = await import('../src/lib/redis.js');
    const ping = await redis.ping();
    return {
      name: 'Upstash Redis reachable',
      pass: ping === 'PONG',
      detail: `ping: ${ping}`,
    };
  } catch (e) {
    return {
      name: 'Upstash Redis reachable',
      pass: false,
      detail: `error: ${(e as Error).message}`,
    };
  }
}

async function gate5_betterAuthSession(): Promise<GateResult> {
  // Just check the auth instance is constructible and exposes expected api.
  try {
    const { auth } = await import('../src/lib/auth.js');
    const hasGetSession = typeof auth.api.getSession === 'function';
    const hasSignUpEmail = typeof auth.api.signUpEmail === 'function';
    const hasSignInEmail = typeof auth.api.signInEmail === 'function';
    const ok = hasGetSession && hasSignUpEmail && hasSignInEmail;
    return {
      name: 'better-auth API surface',
      pass: ok,
      detail: ok ? 'getSession, signUpEmail, signInEmail all present' : 'missing methods',
    };
  } catch (e) {
    return {
      name: 'better-auth API surface',
      pass: false,
      detail: `error: ${(e as Error).message}`,
    };
  }
}

async function gate6_middlewareModulesCompile(): Promise<GateResult> {
  try {
    await import('../src/middleware/session.js');
    await import('../src/middleware/tenant.js');
    await import('../src/middleware/permission.js');
    await import('../src/middleware/rate-limit.js');
    await import('../src/lib/audit.js');
    return {
      name: 'Middleware modules load',
      pass: true,
      detail: 'session, tenant, permission, rate-limit, audit',
    };
  } catch (e) {
    return {
      name: 'Middleware modules load',
      pass: false,
      detail: `error: ${(e as Error).message}`,
    };
  }
}

async function gate7_appBoots(): Promise<GateResult> {
  try {
    const { app } = await import('../src/app.js');
    const res = await app.request('/healthz');
    return {
      name: 'App boots and serves /healthz',
      pass: res.status === 200,
      detail: `GET /healthz → ${res.status}`,
    };
  } catch (e) {
    return {
      name: 'App boots',
      pass: false,
      detail: `error: ${(e as Error).message}`,
    };
  }
}

async function gate8_v1RoutesProtected(): Promise<GateResult> {
  try {
    const { app } = await import('../src/app.js');
    const res = await app.request('/api/v1/tenants');
    return {
      name: '/api/v1/* requires session',
      pass: res.status === 401,
      detail: `unauthenticated GET /api/v1/tenants → ${res.status}`,
    };
  } catch (e) {
    return {
      name: '/api/v1/* requires session',
      pass: false,
      detail: `error: ${(e as Error).message}`,
    };
  }
}

async function main() {
  const gates = [
    gate1_authTablesPresent,
    gate2_bootstrapAdmin,
    gate3_authUserMappedToAppUser,
    gate4_redisAvailable,
    gate5_betterAuthSession,
    gate6_middlewareModulesCompile,
    gate7_appBoots,
    gate8_v1RoutesProtected,
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Sprint 2 Acceptance Gates');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let allPass = true;
  for (const g of gates) {
    const r = await g();
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon}  ${r.name}`);
    console.log(`      ${r.detail}\n`);
    if (!r.pass) allPass = false;
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(allPass ? '🟢 ALL GATES PASSED — Sprint 3 (accounting) can begin' : '🔴 GATES FAILED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await pool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
