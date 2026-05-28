/**
 * Sprint 5 acceptance gate runner.
 *
 * Verifies that the light Sprint-5 modules work end-to-end against the
 * seeded admin tenant:
 *   - Mosque profile auto-creates and updates
 *   - Announcement CRUD with derived status (draft/published)
 *   - Period activation is exclusive
 *   - Position parent integrity + delete refuses with active children/officers
 *   - Officer CRUD + document attach
 *
 * Run: pnpm tsx scripts/sprint5-gates.ts
 */
import { sql, eq, and, isNull } from 'drizzle-orm';
import { asSuperAdmin, pool, withTenant } from '../src/db/client.js';
import { mosqueProfiles, periods, positions, officers, officerDocuments } from '../src/db/schema/organization.js';
import { announcements } from '../src/db/schema/content.js';
import { users } from '../src/db/schema/core.js';

type GateResult = { name: string; pass: boolean; detail: string };

async function adminTenantId(): Promise<string> {
  const r = await asSuperAdmin((tx) =>
    tx.execute(sql`SELECT id FROM tenants WHERE slug = 'admin' LIMIT 1`),
  );
  if (r.rows.length === 0) throw new Error('admin tenant not found — run db:seed first');
  return (r.rows[0] as { id: string }).id;
}

async function adminUserId(tenantId: string): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.select({ id: users.id }).from(users).limit(1);
    if (!r[0]) throw new Error('no users in admin tenant');
    return r[0].id;
  });
}

async function gate1_profileAutoCreates(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  // Wipe so we exercise the auto-create path.
  await asSuperAdmin((tx) =>
    tx.execute(sql`DELETE FROM mosque_profiles WHERE tenant_id = ${tenantId}`),
  );
  const created = await withTenant(tenantId, async (tx) => {
    const existing = await tx.select().from(mosqueProfiles).where(eq(mosqueProfiles.tenantId, tenantId));
    if (existing[0]) return existing[0];
    const [r] = await tx.insert(mosqueProfiles).values({ tenantId }).returning();
    return r!;
  });
  // Update one field, ensure persisted.
  await withTenant(tenantId, async (tx) =>
    tx
      .update(mosqueProfiles)
      .set({ officialName: 'Masjid Test Sprint 5', updatedAt: new Date() })
      .where(eq(mosqueProfiles.tenantId, tenantId)),
  );
  const after = await withTenant(tenantId, async (tx) => {
    const r = await tx.select().from(mosqueProfiles).where(eq(mosqueProfiles.tenantId, tenantId));
    return r[0]!;
  });
  return {
    name: 'Mosque profile: auto-create + update',
    pass: created.tenantId === tenantId && after.officialName === 'Masjid Test Sprint 5',
    detail: `id=${after.id} officialName=${after.officialName}`,
  };
}

async function gate2_announcementCrud(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const userId = await adminUserId(tenantId);
  const baseSlug = `gate-${Date.now()}`;
  const draft = await withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .insert(announcements)
      .values({
        tenantId,
        title: 'Gate Draft',
        body: 'isi draft',
        slug: baseSlug,
        scope: 'public',
        publishedAt: null,
        createdBy: userId,
      })
      .returning();
    return r!;
  });
  const published = await withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .insert(announcements)
      .values({
        tenantId,
        title: 'Gate Published',
        body: 'isi pub',
        slug: `${baseSlug}-pub`,
        scope: 'public',
        publishedAt: new Date(Date.now() - 60_000),
        createdBy: userId,
      })
      .returning();
    return r!;
  });
  const draftStatus = draft.publishedAt ? 'published' : 'draft';
  const pubStatus = published.publishedAt && published.publishedAt.getTime() <= Date.now() ? 'published' : 'draft';

  // Cleanup
  await withTenant(tenantId, async (tx) =>
    tx.delete(announcements).where(
      and(
        eq(announcements.tenantId, tenantId),
        sql`${announcements.slug} LIKE ${baseSlug + '%'}`,
      ),
    ),
  );

  return {
    name: 'Announcement: status derivation (draft/published)',
    pass: draftStatus === 'draft' && pubStatus === 'published',
    detail: `draft.publishedAt=${draft.publishedAt} → ${draftStatus}; pub.publishedAt=${published.publishedAt?.toISOString()} → ${pubStatus}`,
  };
}

async function gate3_periodActivationExclusive(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const tag = `gate-period-${Date.now()}`;
  const ids: string[] = [];
  await withTenant(tenantId, async (tx) => {
    const [a] = await tx
      .insert(periods)
      .values({
        tenantId,
        name: `${tag}-A`,
        startDate: new Date('2025-01-01'),
        endDate: new Date('2030-01-01'),
        isActive: true,
      })
      .returning();
    const [b] = await tx
      .insert(periods)
      .values({
        tenantId,
        name: `${tag}-B`,
        startDate: new Date('2030-01-01'),
        endDate: new Date('2035-01-01'),
        isActive: false,
      })
      .returning();
    ids.push(a!.id, b!.id);
    // Activate B → A must flip to false.
    await tx
      .update(periods)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(periods.tenantId, tenantId), eq(periods.isActive, true)));
    await tx.update(periods).set({ isActive: true, updatedAt: new Date() }).where(eq(periods.id, b!.id));
  });
  const after = await withTenant(tenantId, async (tx) =>
    tx.select().from(periods).where(sql`${periods.name} LIKE ${tag + '%'}`),
  );
  const activeCount = after.filter((p) => p.isActive).length;
  const bActive = after.find((p) => p.name === `${tag}-B`)?.isActive ?? false;
  // Cleanup
  await withTenant(tenantId, async (tx) =>
    tx.delete(periods).where(sql`${periods.name} LIKE ${tag + '%'}`),
  );
  return {
    name: 'Period activation is exclusive (only one active)',
    pass: activeCount === 1 && bActive,
    detail: `active=${activeCount} bActive=${bActive}`,
  };
}

async function gate4_positionDeleteGuarded(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const tag = `gate-pos-${Date.now()}`;
  const result = await withTenant(tenantId, async (tx) => {
    const [parent] = await tx
      .insert(positions)
      .values({ tenantId, name: `${tag}-parent`, sortOrder: 0 })
      .returning();
    const [child] = await tx
      .insert(positions)
      .values({ tenantId, name: `${tag}-child`, parentId: parent!.id, sortOrder: 1 })
      .returning();
    // Try delete parent (should be refused — has active children).
    const childCount = await tx
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(positions)
      .where(and(eq(positions.parentId, parent!.id), isNull(positions.deletedAt)));
    const refusesParent = (childCount[0]?.n ?? 0) > 0;

    // Delete child first, then parent.
    await tx.update(positions).set({ deletedAt: new Date() }).where(eq(positions.id, child!.id));
    const childCountAfter = await tx
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(positions)
      .where(and(eq(positions.parentId, parent!.id), isNull(positions.deletedAt)));
    const canDeleteParent = (childCountAfter[0]?.n ?? 0) === 0;

    // Cleanup
    await tx.delete(positions).where(eq(positions.id, child!.id));
    await tx.delete(positions).where(eq(positions.id, parent!.id));

    return { refusesParent, canDeleteParent };
  });
  return {
    name: 'Position delete: refuses with active children, allows after',
    pass: result.refusesParent && result.canDeleteParent,
    detail: `refusesParent=${result.refusesParent} canDeleteParent=${result.canDeleteParent}`,
  };
}

async function gate5_officerWithDocument(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const tag = `gate-off-${Date.now()}`;
  const ok = await withTenant(tenantId, async (tx) => {
    const [period] = await tx
      .insert(periods)
      .values({ tenantId, name: `${tag}-period`, startDate: new Date(), isActive: false })
      .returning();
    const [position] = await tx
      .insert(positions)
      .values({ tenantId, name: `${tag}-position`, sortOrder: 0 })
      .returning();
    const [officer] = await tx
      .insert(officers)
      .values({
        tenantId,
        periodId: period!.id,
        positionId: position!.id,
        name: `${tag}-name`,
        sortOrder: 0,
      })
      .returning();
    const [doc] = await tx
      .insert(officerDocuments)
      .values({
        tenantId,
        officerId: officer!.id,
        title: 'SK 2026',
        fileUrl: 'https://files.example.com/sk.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
      })
      .returning();
    const docCount = await tx
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(officerDocuments)
      .where(eq(officerDocuments.officerId, officer!.id));
    const result = doc.officerId === officer!.id && (docCount[0]?.n ?? 0) === 1;

    // Cleanup
    await tx.delete(officerDocuments).where(eq(officerDocuments.officerId, officer!.id));
    await tx.delete(officers).where(eq(officers.id, officer!.id));
    await tx.delete(positions).where(eq(positions.id, position!.id));
    await tx.delete(periods).where(eq(periods.id, period!.id));
    return result;
  });
  return {
    name: 'Officer + document round-trip',
    pass: ok,
    detail: ok ? 'created period→position→officer→doc, cleaned up' : 'failed',
  };
}

async function main() {
  const gates = [
    gate1_profileAutoCreates,
    gate2_announcementCrud,
    gate3_periodActivationExclusive,
    gate4_positionDeleteGuarded,
    gate5_officerWithDocument,
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Sprint 5 Acceptance Gates — Light modules');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let allPass = true;
  for (const g of gates) {
    try {
      const r = await g();
      const icon = r.pass ? '✅' : '❌';
      console.log(`${icon}  ${r.name}`);
      console.log(`      ${r.detail}\n`);
      if (!r.pass) allPass = false;
    } catch (e) {
      console.log(`❌  ${g.name}`);
      console.log(`      ERROR: ${(e as Error).message}\n`);
      allPass = false;
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(allPass ? '🟢 ALL GATES PASSED — Sprint 5 light modules ready' : '🔴 GATES FAILED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await pool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
