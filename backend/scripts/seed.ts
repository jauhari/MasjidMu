/**
 * Seed default permissions and system roles.
 *
 * Idempotent: uses ON CONFLICT DO NOTHING. Safe to re-run.
 *
 * What it seeds:
 *   • Permissions catalogue ({module}.{action} codes)
 *   • System roles (super_admin) with full permission grant
 *
 * What it does NOT seed:
 *   • Per-tenant default roles (admin, bendahara, sekretaris, etc.) —
 *     created when a tenant is provisioned, in modules/core/tenants/service.ts
 *   • Specific users — handled by auth flows
 */
import { eq, and, isNull } from 'drizzle-orm';
import { asSuperAdmin, db, pool } from '../src/db/client.js';
import {
  permissions,
  rolePermissions,
  roles,
} from '../src/db/schema/core.js';

// ─── Permissions catalogue ─────────────────────────────────────────────────
const PERMISSIONS: Array<{ code: string; module: string; action: string; description: string }> = [
  // Core
  { code: 'tenants.read', module: 'tenants', action: 'read', description: 'View tenant list' },
  { code: 'tenants.create', module: 'tenants', action: 'create', description: 'Create new tenant' },
  { code: 'tenants.update', module: 'tenants', action: 'update', description: 'Update tenant' },
  { code: 'tenants.delete', module: 'tenants', action: 'delete', description: 'Delete tenant' },
  { code: 'users.read', module: 'users', action: 'read', description: 'View users' },
  { code: 'users.create', module: 'users', action: 'create', description: 'Invite/create users' },
  { code: 'users.update', module: 'users', action: 'update', description: 'Update users' },
  { code: 'users.delete', module: 'users', action: 'delete', description: 'Deactivate users' },
  { code: 'roles.manage', module: 'roles', action: 'manage', description: 'Manage roles & permissions' },
  // Mosque profile
  { code: 'profile.read', module: 'profile', action: 'read', description: 'View mosque profile' },
  { code: 'profile.update', module: 'profile', action: 'update', description: 'Edit mosque profile' },
  // Organization
  { code: 'periods.manage', module: 'organization', action: 'periods.manage', description: 'Manage management periods' },
  { code: 'positions.manage', module: 'organization', action: 'positions.manage', description: 'Manage positions' },
  { code: 'officers.manage', module: 'organization', action: 'officers.manage', description: 'Manage officers' },
  // Accounting
  { code: 'accounts.read', module: 'accounting', action: 'accounts.read', description: 'View Chart of Accounts' },
  { code: 'accounts.manage', module: 'accounting', action: 'accounts.manage', description: 'Manage Chart of Accounts' },
  { code: 'transactions.read', module: 'accounting', action: 'transactions.read', description: 'View transactions' },
  { code: 'transactions.create', module: 'accounting', action: 'transactions.create', description: 'Create transactions' },
  { code: 'transactions.submit', module: 'accounting', action: 'transactions.submit', description: 'Submit transactions for approval' },
  { code: 'transactions.approve.stage1', module: 'accounting', action: 'transactions.approve.stage1', description: 'Approve transactions stage 1' },
  { code: 'transactions.approve.stage2', module: 'accounting', action: 'transactions.approve.stage2', description: 'Approve transactions stage 2' },
  { code: 'transactions.post', module: 'accounting', action: 'transactions.post', description: 'Post transactions (irreversible)' },
  { code: 'transactions.reject', module: 'accounting', action: 'transactions.reject', description: 'Reject transactions' },
  { code: 'transactions.god_mode', module: 'accounting', action: 'transactions.god_mode', description: 'GOD MODE: bypass state machine, force-edit/delete posted transactions (super_admin only)' },
  { code: 'reports.read', module: 'accounting', action: 'reports.read', description: 'View financial reports' },
  { code: 'reports.export', module: 'accounting', action: 'reports.export', description: 'Export financial reports (PDF/XLSX)' },
  // Content
  { code: 'programs.manage', module: 'content', action: 'programs.manage', description: 'Manage programs' },
  { code: 'events.manage', module: 'content', action: 'events.manage', description: 'Manage events' },
  { code: 'announcements.manage', module: 'content', action: 'announcements.manage', description: 'Manage announcements' },
  { code: 'posts.manage', module: 'content', action: 'posts.manage', description: 'Manage posts' },
  { code: 'galleries.manage', module: 'content', action: 'galleries.manage', description: 'Manage galleries' },
  // Audit
  { code: 'audit.read', module: 'audit', action: 'read', description: 'View audit log' },
];

// ─── System roles (tenant_id NULL) ─────────────────────────────────────────
const SYSTEM_ROLES = [
  {
    code: 'super_admin',
    name: 'Super Admin',
    description: 'Platform super admin — full access across all tenants',
    isSystem: true,
  },
] as const;

async function main() {
  console.log('1. Seeding permissions catalogue...');
  const inserted = await db
    .insert(permissions)
    .values(PERMISSIONS)
    .onConflictDoNothing({ target: permissions.code })
    .returning();
  console.log(`   ✓ inserted ${inserted.length} new (skipped ${PERMISSIONS.length - inserted.length} existing)`);

  console.log('2. Seeding system roles (tenant_id NULL) — needs super_admin context...');
  for (const r of SYSTEM_ROLES) {
    await asSuperAdmin(async (tx) => {
      const existing = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.code, r.code), isNull(roles.tenantId)));
      if (existing.length === 0) {
        await tx.insert(roles).values({ ...r, tenantId: null });
        console.log(`   ✓ created system role: ${r.code}`);
      } else {
        console.log(`   • ${r.code} already exists`);
      }
    });
  }

  console.log('3. Granting all permissions to super_admin role...');
  const grantsCount = await asSuperAdmin(async (tx) => {
    const [superAdminRole] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.code, 'super_admin'), isNull(roles.tenantId)));
    if (!superAdminRole) throw new Error('super_admin role missing');

    const allPerms = await tx.select().from(permissions);
    const grants = allPerms.map((p) => ({
      roleId: superAdminRole.id,
      permissionId: p.id,
    }));
    if (grants.length > 0) {
      await tx.insert(rolePermissions).values(grants).onConflictDoNothing();
    }
    return grants.length;
  });
  console.log(`   ✓ granted ${grantsCount} permissions to super_admin`);

  console.log('\n✅ Seed complete.');
  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ Seed failed:', e);
  await pool.end();
  process.exit(1);
});
