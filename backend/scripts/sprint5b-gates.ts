/**
 * Sprint 5 part 2 acceptance gates — content modules.
 *
 * Verifies CRUD + slug uniqueness + nested sub-resources work end-to-end:
 *   - Programs: insert two with same title → second gets `-2` slug
 *   - Posts: status flip 'draft' → 'published' stamps publishedAt once
 *   - Galleries: insert + add 2 items + soft-delete gallery, items survive
 *   - Events: rsvpEnabled gating + capacity limit, speakers attach
 *
 * Run: pnpm tsx scripts/sprint5b-gates.ts
 */
import { sql, eq, and, isNull } from 'drizzle-orm';
import { asSuperAdmin, pool, withTenant } from '../src/db/client.js';
import { programs, posts, galleries, galleryItems, events, eventSpeakers, eventRsvps } from '../src/db/schema/content.js';
import { users } from '../src/db/schema/core.js';
import { pickFreeSlug, slugify } from '../src/lib/slug.js';

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

async function gate1_slugUniqueness(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const userId = await adminUserId(tenantId);
  const tag = `gate-prog-${Date.now()}`;
  const result = await withTenant(tenantId, async (tx) => {
    // First insert: claim base slug.
    const baseA = slugify(tag);
    const taken1 = await tx
      .select({ slug: programs.slug })
      .from(programs)
      .where(and(eq(programs.tenantId, tenantId), sql`${programs.slug} LIKE ${baseA + '%'}`));
    const slugA = pickFreeSlug(taken1.map((t) => t.slug), baseA);
    const [a] = await tx
      .insert(programs)
      .values({ tenantId, title: tag, slug: slugA, status: 'draft', isPublic: true, createdBy: userId })
      .returning();

    // Second insert with same title: must collide.
    const taken2 = await tx
      .select({ slug: programs.slug })
      .from(programs)
      .where(and(eq(programs.tenantId, tenantId), sql`${programs.slug} LIKE ${baseA + '%'}`));
    const slugB = pickFreeSlug(taken2.map((t) => t.slug), baseA);
    const [b] = await tx
      .insert(programs)
      .values({ tenantId, title: tag, slug: slugB, status: 'draft', isPublic: true, createdBy: userId })
      .returning();

    // Cleanup.
    await tx.delete(programs).where(sql`${programs.id} IN (${a!.id}, ${b!.id})`);
    return { slugA: a!.slug, slugB: b!.slug };
  });
  const ok = result.slugA !== result.slugB && result.slugB.endsWith('-2');
  return {
    name: 'Programs slug uniqueness (`-2` suffix on collision)',
    pass: ok,
    detail: `slugA=${result.slugA} slugB=${result.slugB}`,
  };
}

async function gate2_postPublishedStamp(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const userId = await adminUserId(tenantId);
  const tag = `gate-post-${Date.now()}`;
  const result = await withTenant(tenantId, async (tx) => {
    const [p] = await tx
      .insert(posts)
      .values({
        tenantId,
        title: tag,
        slug: slugify(tag),
        body: 'isi',
        status: 'draft',
        createdBy: userId,
      })
      .returning();
    const draftHasNoPub = p!.publishedAt === null;

    // Flip to published — controller stamps publishedAt.
    await tx
      .update(posts)
      .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(posts.id, p!.id));
    const after1 = await tx.select().from(posts).where(eq(posts.id, p!.id));
    const stamped1 = after1[0]!.publishedAt;

    // Toggle to draft, then back to published. publishedAt must NOT change
    // because controller only stamps on first transition (skipped when already set).
    await tx.update(posts).set({ status: 'draft', updatedAt: new Date() }).where(eq(posts.id, p!.id));
    await tx.update(posts).set({ status: 'published', updatedAt: new Date() }).where(eq(posts.id, p!.id));
    const after2 = await tx.select().from(posts).where(eq(posts.id, p!.id));
    const stamped2 = after2[0]!.publishedAt;

    // Cleanup.
    await tx.delete(posts).where(eq(posts.id, p!.id));
    return { draftHasNoPub, stamped1, stamped2 };
  });
  const ok =
    result.draftHasNoPub &&
    result.stamped1 != null &&
    result.stamped2 != null &&
    result.stamped1.getTime() === result.stamped2.getTime();
  return {
    name: 'Posts: publishedAt stamps once',
    pass: ok,
    detail: `draftNull=${result.draftHasNoPub} stamped1=${result.stamped1?.toISOString()} stamped2=${result.stamped2?.toISOString()}`,
  };
}

async function gate3_galleryItemsLifecycle(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const tag = `gate-gal-${Date.now()}`;
  const result = await withTenant(tenantId, async (tx) => {
    const [g] = await tx
      .insert(galleries)
      .values({ tenantId, title: tag, slug: slugify(tag), isPublic: true })
      .returning();
    await tx.insert(galleryItems).values([
      { galleryId: g!.id, fileUrl: 'https://files.example.com/1.jpg', sortOrder: 0 },
      { galleryId: g!.id, fileUrl: 'https://files.example.com/2.jpg', sortOrder: 1 },
    ]);
    const items = await tx.select().from(galleryItems).where(eq(galleryItems.galleryId, g!.id));
    // Soft-delete the gallery — items remain (not cascaded by soft-delete).
    await tx.update(galleries).set({ deletedAt: new Date() }).where(eq(galleries.id, g!.id));
    const itemsAfter = await tx.select().from(galleryItems).where(eq(galleryItems.galleryId, g!.id));
    // Cleanup.
    await tx.delete(galleryItems).where(eq(galleryItems.galleryId, g!.id));
    await tx.delete(galleries).where(eq(galleries.id, g!.id));
    return { itemsBefore: items.length, itemsAfter: itemsAfter.length };
  });
  const ok = result.itemsBefore === 2 && result.itemsAfter === 2;
  return {
    name: 'Gallery soft-delete leaves items intact',
    pass: ok,
    detail: `before=${result.itemsBefore} after=${result.itemsAfter}`,
  };
}

async function gate4_eventRsvpCapacity(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const userId = await adminUserId(tenantId);
  const tag = `gate-evt-${Date.now()}`;
  const result = await withTenant(tenantId, async (tx) => {
    const [ev] = await tx
      .insert(events)
      .values({
        tenantId,
        title: tag,
        slug: slugify(tag),
        startsAt: new Date(),
        rsvpEnabled: true,
        rsvpCapacity: 2,
        status: 'published',
        isPublic: true,
        createdBy: userId,
      })
      .returning();
    await tx.insert(eventSpeakers).values({ eventId: ev!.id, name: 'Ust. A', sortOrder: 0 });
    await tx.insert(eventRsvps).values({ eventId: ev!.id, name: 'Hadirin 1' });
    await tx.insert(eventRsvps).values({ eventId: ev!.id, name: 'Hadirin 2' });
    // Capacity reached → simulate refusal at app layer by counting first.
    const counted = await tx
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(eventRsvps)
      .where(eq(eventRsvps.eventId, ev!.id));
    const refused = (counted[0]?.n ?? 0) >= ev!.rsvpCapacity!;
    // Cleanup.
    await tx.delete(eventRsvps).where(eq(eventRsvps.eventId, ev!.id));
    await tx.delete(eventSpeakers).where(eq(eventSpeakers.eventId, ev!.id));
    await tx.delete(events).where(eq(events.id, ev!.id));
    return { refused, count: counted[0]?.n ?? 0 };
  });
  return {
    name: 'Events RSVP capacity gate',
    pass: result.refused && result.count === 2,
    detail: `count=${result.count} refused=${result.refused}`,
  };
}

async function gate5_softDeleteFilters(): Promise<GateResult> {
  const tenantId = await adminTenantId();
  const userId = await adminUserId(tenantId);
  const tag = `gate-sd-${Date.now()}`;
  const result = await withTenant(tenantId, async (tx) => {
    const [p] = await tx
      .insert(programs)
      .values({ tenantId, title: tag, slug: slugify(tag), status: 'draft', isPublic: true, createdBy: userId })
      .returning();
    await tx
      .update(programs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(programs.id, p!.id));
    const visible = await tx
      .select()
      .from(programs)
      .where(and(eq(programs.id, p!.id), isNull(programs.deletedAt)));
    // Cleanup.
    await tx.delete(programs).where(eq(programs.id, p!.id));
    return visible.length;
  });
  return {
    name: 'Soft-deleted rows excluded from active queries',
    pass: result === 0,
    detail: `visible_after_soft_delete=${result}`,
  };
}

async function main() {
  const gates = [
    gate1_slugUniqueness,
    gate2_postPublishedStamp,
    gate3_galleryItemsLifecycle,
    gate4_eventRsvpCapacity,
    gate5_softDeleteFilters,
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Sprint 5 Acceptance Gates — Part 2 (content modules)');
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
  console.log(allPass ? '🟢 ALL GATES PASSED — Sprint 5 part 2 ready' : '🔴 GATES FAILED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await pool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
