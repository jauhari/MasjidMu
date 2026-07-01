/**
 * One-time migration: rename platform tenant slug admin → al-uula.
 *
 * Run: pnpm tsx scripts/rename-tenant-admin-to-al-uula.ts
 */
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
config({ path: '.env.local' });
import { asSuperAdmin, withTenant, pool } from '../src/db/client.js';
import { tenants } from '../src/db/schema/core.js';
import { mosqueProfiles } from '../src/db/schema/organization.js';
import { _clearTenantCache } from '../src/middleware/tenant.js';

async function main() {
  const result = await asSuperAdmin(async (tx) => {
    const [admin] = await tx.select().from(tenants).where(eq(tenants.slug, 'admin'));
    if (!admin) {
      const [existing] = await tx.select().from(tenants).where(eq(tenants.slug, 'al-uula'));
      if (existing) {
        return { status: 'already_migrated', tenant: existing };
      }
      throw new Error('tenant admin not found and al-uula does not exist');
    }

    const [conflict] = await tx.select().from(tenants).where(eq(tenants.slug, 'al-uula'));
    if (conflict) throw new Error('slug al-uula already taken by another tenant');

    const [tenant] = await tx
      .update(tenants)
      .set({
        slug: 'al-uula',
        name: 'Masjid Al-Uula',
        shortName: 'Al-Uula',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, admin.id))
      .returning();

    return { status: 'migrated', tenant: tenant! };
  });

  if (result.status === 'migrated') {
    await withTenant(result.tenant.id, async (ptx) => {
      const [profile] = await ptx
        .select()
        .from(mosqueProfiles)
        .where(eq(mosqueProfiles.tenantId, result.tenant.id));
      if (profile) {
        await ptx
          .update(mosqueProfiles)
          .set({
            officialName: 'Masjid Al-Uula',
            shortName: 'Al-Uula',
            updatedAt: new Date(),
          })
          .where(eq(mosqueProfiles.tenantId, result.tenant.id));
      } else {
        await ptx.insert(mosqueProfiles).values({
          tenantId: result.tenant.id,
          officialName: 'Masjid Al-Uula',
          shortName: 'Al-Uula',
        });
      }
    });
  }

  _clearTenantCache();
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
}

main().catch(async (e) => {
  console.error('❌', e);
  await pool.end();
  process.exit(1);
});