import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './core.js';
import { tenants } from './core.js';

// ─── Enums ─────────────────────────────────────────────────────────────────
export const programStatusEnum = pgEnum('program_status', [
  'draft',
  'active',
  'completed',
  'cancelled',
]);

export const eventStatusEnum = pgEnum('event_status', [
  'draft',
  'published',
  'cancelled',
  'completed',
]);

export const announcementScopeEnum = pgEnum('announcement_scope', [
  'public',
  'internal',
  'urgent',
]);

export const postStatusEnum = pgEnum('post_status', ['draft', 'published', 'archived']);

// ─── Programs ──────────────────────────────────────────────────────────────
export const programs = pgTable(
  'programs',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: varchar({ length: 200 }).notNull(),
    title: varchar({ length: 200 }).notNull(),
    description: text(),
    coverUrl: text(),
    targetAmount: numeric({ precision: 18, scale: 2 }),
    collectedAmount: numeric({ precision: 18, scale: 2 }).default('0'),
    startDate: timestamp({ withTimezone: true }),
    endDate: timestamp({ withTimezone: true }),
    status: programStatusEnum().default('draft').notNull(),
    isPublic: boolean().default(true).notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    uniqueTenantSlug: unique().on(t.tenantId, t.slug),
    tenantIdx: index().on(t.tenantId),
    targetNonNeg: check('prog_target_non_neg', sql`${t.targetAmount} IS NULL OR ${t.targetAmount} >= 0`),
  }),
);

// ─── Events / Agenda ───────────────────────────────────────────────────────
export const events = pgTable(
  'events',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: varchar({ length: 200 }).notNull(),
    title: varchar({ length: 200 }).notNull(),
    description: text(),
    coverUrl: text(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }),
    location: text(),
    rsvpEnabled: boolean().default(false).notNull(),
    rsvpCapacity: integer(),
    status: eventStatusEnum().default('draft').notNull(),
    isPublic: boolean().default(true).notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    uniqueTenantSlug: unique().on(t.tenantId, t.slug),
    tenantStartIdx: index().on(t.tenantId, t.startsAt),
  }),
);

export const eventSpeakers = pgTable(
  'event_speakers',
  {
    id: uuid().primaryKey().defaultRandom(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: varchar({ length: 200 }).notNull(),
    role: varchar({ length: 100 }),
    bio: text(),
    photoUrl: text(),
    sortOrder: integer().default(0).notNull(),
  },
  (t) => ({
    eventIdx: index().on(t.eventId),
  }),
);

export const eventRsvps = pgTable(
  'event_rsvps',
  {
    id: uuid().primaryKey().defaultRandom(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: varchar({ length: 200 }).notNull(),
    email: varchar({ length: 255 }),
    phone: varchar({ length: 30 }),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    eventIdx: index().on(t.eventId),
  }),
);

// ─── Announcements ─────────────────────────────────────────────────────────
export const announcements = pgTable(
  'announcements',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: varchar({ length: 200 }).notNull(),
    title: varchar({ length: 200 }).notNull(),
    body: text().notNull(),
    scope: announcementScopeEnum().default('public').notNull(),
    publishedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    uniqueTenantSlug: unique().on(t.tenantId, t.slug),
    tenantPubIdx: index().on(t.tenantId, t.publishedAt),
  }),
);

// ─── Posts (rich-text articles, SEO) ───────────────────────────────────────
export const posts = pgTable(
  'posts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: varchar({ length: 200 }).notNull(),
    title: varchar({ length: 200 }).notNull(),
    excerpt: text(),
    body: text().notNull(),
    coverUrl: text(),
    seoTitle: varchar({ length: 200 }),
    seoDescription: varchar({ length: 500 }),
    status: postStatusEnum().default('draft').notNull(),
    publishedAt: timestamp({ withTimezone: true }),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    uniqueTenantSlug: unique().on(t.tenantId, t.slug),
    tenantStatusIdx: index().on(t.tenantId, t.status),
  }),
);

// ─── Galleries ─────────────────────────────────────────────────────────────
export const galleries = pgTable(
  'galleries',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: varchar({ length: 200 }).notNull(),
    title: varchar({ length: 200 }).notNull(),
    description: text(),
    coverUrl: text(),
    isPublic: boolean().default(true).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    uniqueTenantSlug: unique().on(t.tenantId, t.slug),
  }),
);

export const galleryItems = pgTable(
  'gallery_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    galleryId: uuid()
      .notNull()
      .references(() => galleries.id, { onDelete: 'cascade' }),
    fileUrl: text().notNull(),
    caption: text(),
    sortOrder: integer().default(0).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    galleryIdx: index().on(t.galleryId),
  }),
);

// ─── Notifications (in-app only for MVP) ───────────────────────────────────
export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar({ length: 50 }).notNull(),
    title: varchar({ length: 200 }).notNull(),
    body: text(),
    linkUrl: text(),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userReadIdx: index().on(t.userId, t.readAt),
  }),
);

export type Program = typeof programs.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type Post = typeof posts.$inferSelect;
