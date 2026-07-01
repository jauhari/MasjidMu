/**
 * Events (event & kegiatan) — module 7.
 *
 * Per-tenant CRUD for events; nested CRUD for speakers and RSVPs.
 *
 * Routes:
 *   GET    /api/v1/events?status=&from=&to=
 *   GET    /api/v1/events/:id           (includes speakers + rsvp count)
 *   POST   /api/v1/events
 *   PATCH  /api/v1/events/:id
 *   DELETE /api/v1/events/:id           soft delete
 *
 *   POST   /api/v1/events/:id/speakers
 *   PATCH  /api/v1/events/:id/speakers/:speakerId
 *   DELETE /api/v1/events/:id/speakers/:speakerId
 *
 *   GET    /api/v1/events/:id/rsvps
 *   POST   /api/v1/events/:id/rsvps     (open to anyone with session — public RSVP via portal proxy in Module 12)
 *   DELETE /api/v1/events/:id/rsvps/:rsvpId
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, asc, desc, eq, isNull, like, sql } from 'drizzle-orm';
import { withTenant } from '../../../db/client.js';
import { eventRsvps, eventSpeakers, events } from '../../../db/schema/content.js';
import { requireSession, type SessionVars } from '../../../middleware/session.js';
import { requireTenant, type TenantVars } from '../../../middleware/tenant.js';
import { requirePermission, type PermissionVars } from '../../../middleware/permission.js';
import { auditInterceptor } from '../../../lib/audit.js';
import {
  generateOccurrenceStarts,
  groupEventsBySeries,
  RECURRENCE_TYPES,
  shiftEndsAt,
  type RecurrenceType,
} from '../../../lib/event-recurrence.js';
import { pickFreeSlug, slugify } from '../../../lib/slug.js';
import { resolveActingUser } from '../../../lib/user-mapping.js';

const STATUS = ['draft', 'published', 'cancelled', 'completed'] as const;

const createSchema = z
  .object({
    title: z.string().min(2).max(200),
    slug: z.string().max(200).optional(),
    description: z.string().nullable().optional(),
    coverUrl: z.string().url().nullable().optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().nullable().optional(),
    location: z.string().nullable().optional(),
    rsvpEnabled: z.boolean().default(false),
    rsvpCapacity: z.number().int().min(1).nullable().optional(),
    status: z.enum(STATUS).default('draft'),
    isPublic: z.boolean().default(true),
    recurrenceType: z.enum(RECURRENCE_TYPES).default('none'),
    intervalDays: z.number().int().min(1).max(365).nullable().optional(),
    recurrenceUntil: z.string().datetime().nullable().optional(),
    recurrenceOpenEnded: z.boolean().default(false),
  })
  .refine((v) => !v.endsAt || new Date(v.endsAt) >= new Date(v.startsAt), {
    message: 'endsAt must be on or after startsAt',
    path: ['endsAt'],
  })
  .refine(
    (v) => v.recurrenceType !== 'interval_days' || (v.intervalDays != null && v.intervalDays >= 1),
    { message: 'intervalDays required for interval_days recurrence', path: ['intervalDays'] },
  );

const updateSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  slug: z.string().max(200).optional(),
  description: z.string().nullable().optional(),
  coverUrl: z.string().url().nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  location: z.string().nullable().optional(),
  rsvpEnabled: z.boolean().optional(),
  rsvpCapacity: z.number().int().min(1).nullable().optional(),
  status: z.enum(STATUS).optional(),
  isPublic: z.boolean().optional(),
});

const listQuerySchema = z.object({
  status: z.enum(STATUS).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  group: z.enum(['series', 'occurrences']).default('occurrences'),
});

const speakerSchema = z.object({
  name: z.string().min(2).max(200),
  role: z.string().max(100).nullable().optional(),
  bio: z.string().nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

const rsvpSchema = z.object({
  name: z.string().min(2).max(200),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  note: z.string().nullable().optional(),
});

export const eventsRoute = new Hono<{
  Variables: SessionVars & TenantVars & PermissionVars;
}>()
  .use('*', requireSession())
  .use('*', requireTenant())
  .use('*', auditInterceptor())

  .get('/', zValidator('query', listQuerySchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const q = c.req.valid('query');
    const result = await withTenant(tenantId, async (tx) => {
      const conds = [isNull(events.deletedAt)];
      if (q.status) conds.push(eq(events.status, q.status));
      if (q.from) conds.push(sql`${events.startsAt} >= ${new Date(q.from).toISOString()}::timestamptz`);
      if (q.to) conds.push(sql`${events.startsAt} <= ${new Date(q.to).toISOString()}::timestamptz`);

      if (q.group === 'occurrences') {
        const rows = await tx
          .select()
          .from(events)
          .where(and(...conds))
          .orderBy(desc(events.startsAt))
          .limit(q.limit)
          .offset(q.offset);
        return { rows, total: null as number | null };
      }

      const all = await tx
        .select()
        .from(events)
        .where(and(...conds))
        .orderBy(desc(events.startsAt));
      const grouped = groupEventsBySeries(all);
      return {
        rows: grouped.slice(q.offset, q.offset + q.limit),
        total: grouped.length,
      };
    });
    return c.json({
      data: result.rows,
      meta: { limit: q.limit, offset: q.offset, total: result.total, group: q.group },
    });
  })

  .get('/:id', async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const result = await withTenant(tenantId, async (tx) => {
      const e = await tx
        .select()
        .from(events)
        .where(and(eq(events.id, id), isNull(events.deletedAt)));
      if (!e[0]) return null;
      const speakers = await tx
        .select()
        .from(eventSpeakers)
        .where(eq(eventSpeakers.eventId, id))
        .orderBy(asc(eventSpeakers.sortOrder), asc(eventSpeakers.name));
      const rsvpCount = await tx
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(eventRsvps)
        .where(eq(eventRsvps.eventId, id));
      return { ...e[0], speakers, rsvpCount: rsvpCount[0]?.n ?? 0 };
    });
    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: result });
  })

  .post('/', requirePermission('events.manage'), zValidator('json', createSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const authUser = c.get('user')!;
    const tenantUser = await resolveActingUser(authUser, tenantId, !!c.get('isSuperAdmin'));
    if (!tenantUser) return c.json({ error: 'tenant_user_missing' }, 422);
    const body = c.req.valid('json');
    const anchorStart = new Date(body.startsAt);
    const anchorEnd = body.endsAt ? new Date(body.endsAt) : null;
    const recurrenceType = body.recurrenceType as RecurrenceType;
    const openEnded = body.recurrenceOpenEnded && recurrenceType !== 'none';
    const recurrenceUntil = openEnded
      ? null
      : body.recurrenceUntil
        ? new Date(body.recurrenceUntil)
        : null;
    const occurrenceStarts = generateOccurrenceStarts({
      type: recurrenceType,
      startsAt: anchorStart,
      intervalDays: body.intervalDays ?? undefined,
      recurrenceUntil,
      openEnded,
    });

    const created = await withTenant(tenantId, async (tx) => {
      const base = slugify(body.slug ?? body.title);
      const takenRows = await tx
        .select({ slug: events.slug })
        .from(events)
        .where(and(eq(events.tenantId, tenantId), like(events.slug, `${base}%`)));
      const taken = new Set(takenRows.map((t) => t.slug));
      const seriesId = recurrenceType === 'none' ? null : crypto.randomUUID();
      const recurrenceWeekday =
        recurrenceType === 'weekly' ? anchorStart.getUTCDay() : null;

      const rows = occurrenceStarts.map((start, index) => {
        const slugSuffix =
          index === 0 ? '' : `-${start.toISOString().slice(0, 10)}`;
        const slug = pickFreeSlug(taken, `${base}${slugSuffix}`);
        taken.add(slug);
        return {
          tenantId,
          title: body.title,
          slug,
          description: body.description ?? null,
          coverUrl: body.coverUrl ?? null,
          startsAt: start,
          endsAt: shiftEndsAt(start, anchorStart, anchorEnd),
          location: body.location ?? null,
          rsvpEnabled: body.rsvpEnabled,
          rsvpCapacity: body.rsvpCapacity ?? null,
          status: body.status,
          isPublic: body.isPublic,
          seriesId,
          recurrenceType,
          intervalDays: recurrenceType === 'interval_days' ? body.intervalDays ?? null : null,
          recurrenceWeekday,
          recurrenceUntil,
          occurrenceIndex: index,
          createdBy: tenantUser.id,
        };
      });

      const inserted = await tx.insert(events).values(rows).returning();
      return { primary: inserted[0]!, seriesCount: inserted.length };
    });
    return c.json(
      { data: created.primary, meta: { seriesCount: created.seriesCount } },
      201,
    );
  })

  .patch('/:id', requirePermission('events.manage'), zValidator('json', updateSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const updated = await withTenant(tenantId, async (tx) => {
      const next: Partial<typeof events.$inferInsert> = { updatedAt: new Date() };
      if (body.title !== undefined) next.title = body.title;
      if (body.description !== undefined) next.description = body.description;
      if (body.coverUrl !== undefined) next.coverUrl = body.coverUrl;
      if (body.startsAt !== undefined) next.startsAt = new Date(body.startsAt);
      if (body.endsAt !== undefined) next.endsAt = body.endsAt ? new Date(body.endsAt) : null;
      if (body.location !== undefined) next.location = body.location;
      if (body.rsvpEnabled !== undefined) next.rsvpEnabled = body.rsvpEnabled;
      if (body.rsvpCapacity !== undefined) next.rsvpCapacity = body.rsvpCapacity;
      if (body.status !== undefined) next.status = body.status;
      if (body.isPublic !== undefined) next.isPublic = body.isPublic;
      if (body.slug !== undefined) {
        const base = slugify(body.slug);
        const taken = await tx
          .select({ slug: events.slug })
          .from(events)
          .where(and(eq(events.tenantId, tenantId), like(events.slug, `${base}%`)));
        next.slug = pickFreeSlug(taken.map((t) => t.slug), base);
      }
      const [r] = await tx
        .update(events)
        .set(next)
        .where(and(eq(events.id, id), isNull(events.deletedAt)))
        .returning();
      return r ?? null;
    });
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: updated });
  })

  .delete('/:id', requirePermission('events.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const scope = c.req.query('scope');
    const deleted = await withTenant(tenantId, async (tx) => {
      const existing = await tx
        .select({ id: events.id, seriesId: events.seriesId })
        .from(events)
        .where(and(eq(events.id, id), isNull(events.deletedAt)));
      const row = existing[0];
      if (!row) return null;

      const now = new Date();
      if (scope === 'series' && row.seriesId) {
        const removed = await tx
          .update(events)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(eq(events.seriesId, row.seriesId), isNull(events.deletedAt)))
          .returning({ id: events.id });
        return { id: row.id, seriesDeleted: removed.length };
      }

      const [r] = await tx
        .update(events)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(events.id, id), isNull(events.deletedAt)))
        .returning();
      return r ? { id: r.id, seriesDeleted: 1 } : null;
    });
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: deleted });
  })

  // ─── Speakers ───────────────────────────────────────────────────────────
  .post(
    '/:id/speakers',
    requirePermission('events.manage'),
    zValidator('json', speakerSchema),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const result = await withTenant(tenantId, async (tx) => {
        const e = await tx
          .select({ id: events.id })
          .from(events)
          .where(and(eq(events.id, id), isNull(events.deletedAt)));
        if (!e[0]) return { error: 'event_not_found' as const };
        const [r] = await tx
          .insert(eventSpeakers)
          .values({ eventId: id, ...body })
          .returning();
        return { row: r! };
      });
      if ('error' in result) return c.json({ error: result.error }, 404);
      return c.json({ data: result.row }, 201);
    },
  )

  .patch(
    '/:id/speakers/:speakerId',
    requirePermission('events.manage'),
    zValidator('json', speakerSchema.partial()),
    async (c) => {
      const tenantId = c.get('tenantId')!;
      const id = c.req.param('id');
      const speakerId = c.req.param('speakerId');
      const body = c.req.valid('json');
      const updated = await withTenant(tenantId, async (tx) => {
        if (Object.keys(body).length === 0) return null;
        const [r] = await tx
          .update(eventSpeakers)
          .set(body)
          .where(and(eq(eventSpeakers.id, speakerId), eq(eventSpeakers.eventId, id)))
          .returning();
        return r ?? null;
      });
      if (!updated) return c.json({ error: 'not_found' }, 404);
      return c.json({ data: updated });
    },
  )

  .delete('/:id/speakers/:speakerId', requirePermission('events.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const speakerId = c.req.param('speakerId');
    const deleted = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .delete(eventSpeakers)
        .where(and(eq(eventSpeakers.id, speakerId), eq(eventSpeakers.eventId, id)))
        .returning();
      return r ?? null;
    });
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: { id: deleted.id } });
  })

  // ─── RSVPs ──────────────────────────────────────────────────────────────
  .get('/:id/rsvps', async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const rows = await withTenant(tenantId, async (tx) =>
      tx.select().from(eventRsvps).where(eq(eventRsvps.eventId, id)).orderBy(desc(eventRsvps.createdAt)),
    );
    return c.json({ data: rows });
  })

  .post('/:id/rsvps', zValidator('json', rsvpSchema), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const result = await withTenant(tenantId, async (tx) => {
      const e = await tx
        .select()
        .from(events)
        .where(and(eq(events.id, id), isNull(events.deletedAt)));
      const ev = e[0];
      if (!ev) return { error: 'event_not_found' as const };
      if (!ev.rsvpEnabled) return { error: 'rsvp_disabled' as const };
      if (ev.rsvpCapacity != null) {
        const counted = await tx
          .select({ n: sql<number>`COUNT(*)::int` })
          .from(eventRsvps)
          .where(eq(eventRsvps.eventId, id));
        if ((counted[0]?.n ?? 0) >= ev.rsvpCapacity) {
          return { error: 'rsvp_full' as const };
        }
      }
      const [r] = await tx
        .insert(eventRsvps)
        .values({
          eventId: id,
          name: body.name,
          email: body.email ?? null,
          phone: body.phone ?? null,
          note: body.note ?? null,
        })
        .returning();
      return { row: r! };
    });
    if ('error' in result) {
      const status = result.error === 'event_not_found' ? 404 : 409;
      return c.json({ error: result.error }, status);
    }
    return c.json({ data: result.row }, 201);
  })

  .delete('/:id/rsvps/:rsvpId', requirePermission('events.manage'), async (c) => {
    const tenantId = c.get('tenantId')!;
    const id = c.req.param('id');
    const rsvpId = c.req.param('rsvpId');
    const deleted = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .delete(eventRsvps)
        .where(and(eq(eventRsvps.id, rsvpId), eq(eventRsvps.eventId, id)))
        .returning();
      return r ?? null;
    });
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: { id: deleted.id } });
  });
