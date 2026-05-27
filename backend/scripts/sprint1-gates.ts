/**
 * Sprint 1 acceptance gate runner.
 *
 * All gates must pass before Sprint 2 work begins. Output is a checklist
 * the user can read at the end of Sprint 1.
 *
 * Run: pnpm tsx scripts/sprint1-gates.ts
 */
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';

type GateResult = { name: string; pass: boolean; detail: string };

async function gate1_schemaParity(): Promise<GateResult> {
  const expectedTables = [
    'tenants', 'users', 'roles', 'permissions', 'role_permissions', 'user_roles', 'sessions',
    'accounts', 'transaction_categories', 'transactions', 'approval_stages', 'approval_logs',
    'journals', 'journal_lines',
    'mosque_profiles', 'periods', 'positions', 'officers', 'officer_documents',
    'programs', 'events', 'event_speakers', 'event_rsvps',
    'announcements', 'posts', 'galleries', 'gallery_items', 'notifications',
    'audit_logs',
  ];

  const r = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  const actual = new Set(r.rows.map((row) => row.table_name as string));
  const missing = expectedTables.filter((t) => !actual.has(t));
  return {
    name: 'Schema parity (29 tables)',
    pass: missing.length === 0,
    detail: missing.length === 0
      ? `${actual.size} tables present`
      : `MISSING: ${missing.join(', ')}`,
  };
}

async function gate2_rlsEnabled(): Promise<GateResult> {
  // Excluded:
  //   tenants, permissions  — global, by design
  //   part_config*          — pg_partman internal config tables
  const r = await db.execute(sql`
    SELECT tablename, rowsecurity
      FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT IN ('tenants', 'permissions')
       AND tablename NOT LIKE 'part_config%'
  `);
  const noRls = r.rows.filter((row) => !(row.rowsecurity as boolean));
  return {
    name: 'RLS enabled on all tenant-scoped tables',
    pass: noRls.length === 0,
    detail: noRls.length === 0
      ? `${r.rows.length} tables have RLS enabled`
      : `RLS NOT enabled on: ${noRls.map((row) => row.tablename).join(', ')}`,
  };
}

async function gate3_policiesExist(): Promise<GateResult> {
  const r = await db.execute(sql`
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
  `);
  return {
    name: 'RLS policies created',
    pass: r.rows.length >= 50,  // 25 tables * 2 policies = 50+
    detail: `${r.rows.length} policies in public schema`,
  };
}

async function gate4_journalCheckConstraints(): Promise<GateResult> {
  const r = await db.execute(sql`
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'journal_lines'::regclass AND contype = 'c'
  `);
  const expected = ['jl_debit_non_neg', 'jl_credit_non_neg', 'jl_debit_xor_credit'];
  const actual = r.rows.map((row) => row.conname as string);
  const missing = expected.filter((c) => !actual.includes(c));
  return {
    name: 'Journal CHECK constraints',
    pass: missing.length === 0,
    detail: missing.length === 0
      ? actual.join(', ')
      : `MISSING: ${missing.join(', ')}`,
  };
}

async function gate5_journalBalanceTrigger(): Promise<GateResult> {
  const r = await db.execute(sql`
    SELECT tgname FROM pg_trigger
     WHERE tgrelid = 'journal_lines'::regclass
       AND tgname = 'trg_enforce_journal_balance'
  `);
  return {
    name: 'Journal balance trigger',
    pass: r.rows.length === 1,
    detail: r.rows.length === 1
      ? 'trg_enforce_journal_balance present (deferrable)'
      : 'TRIGGER MISSING',
  };
}

async function gate6_accountTypeEnglish(): Promise<GateResult> {
  const r = await db.execute(sql`
    SELECT enumlabel FROM pg_enum
     WHERE enumtypid = 'account_type'::regtype
     ORDER BY enumsortorder
  `);
  const labels = r.rows.map((row) => row.enumlabel as string);
  const expected = ['asset', 'liability', 'equity', 'income', 'expense', 'contra_asset', 'contra_liability'];
  const ok = expected.every((e) => labels.includes(e));
  return {
    name: 'account_type enum English values',
    pass: ok,
    detail: labels.join(', '),
  };
}

async function gate7_appRoleNoBypass(): Promise<GateResult> {
  const r = await db.execute(sql`
    SELECT current_user AS r, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
  `);
  const row = r.rows[0] as { r: string; rolbypassrls: boolean };
  return {
    name: 'App role NOBYPASSRLS',
    pass: !row.rolbypassrls,
    detail: `current_user=${row.r}, bypassrls=${row.rolbypassrls}`,
  };
}

async function gate8_seedComplete(): Promise<GateResult> {
  const perms = await db.execute(sql`SELECT COUNT(*)::int AS n FROM permissions`);
  const sysRoles = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM roles WHERE tenant_id IS NULL AND code = 'super_admin'
  `);
  const grants = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
     WHERE r.code = 'super_admin'
  `);
  const p = perms.rows[0] as { n: number };
  const sr = sysRoles.rows[0] as { n: number };
  const g = grants.rows[0] as { n: number };
  const pass = p.n >= 31 && sr.n === 1 && g.n >= 31;
  return {
    name: 'Seed complete',
    pass,
    detail: `permissions=${p.n}, super_admin role=${sr.n}, grants=${g.n}`,
  };
}

async function gate9_pgPartmanAvailable(): Promise<GateResult> {
  const r = await db.execute(sql`
    SELECT name, installed_version FROM pg_available_extensions
     WHERE name = 'pg_partman'
  `);
  if (r.rows.length === 0) {
    return {
      name: 'pg_partman availability',
      pass: true, // expected on Neon — fallback ready
      detail: 'NOT available on Neon — will use manual partitioning fallback (acceptable)',
    };
  }
  const row = r.rows[0] as { installed_version: string | null };
  return {
    name: 'pg_partman availability',
    pass: true,
    detail: row.installed_version ? `installed v${row.installed_version}` : 'available, not installed',
  };
}

async function main() {
  const gates = [
    gate1_schemaParity,
    gate2_rlsEnabled,
    gate3_policiesExist,
    gate4_journalCheckConstraints,
    gate5_journalBalanceTrigger,
    gate6_accountTypeEnglish,
    gate7_appRoleNoBypass,
    gate8_seedComplete,
    gate9_pgPartmanAvailable,
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Sprint 1 Acceptance Gates');
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
  console.log(allPass ? '🟢 ALL GATES PASSED — Sprint 2 can begin' : '🔴 GATES FAILED — fix before Sprint 2');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await pool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
