import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './core.js';

// ─── Mosque Profile ────────────────────────────────────────────────────────
export const mosqueProfiles = pgTable('mosque_profiles', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid()
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  officialName: varchar({ length: 200 }),
  shortName: varchar({ length: 100 }),
  // Address
  province: varchar({ length: 100 }),
  city: varchar({ length: 100 }),
  district: varchar({ length: 100 }),
  village: varchar({ length: 100 }),
  postalCode: varchar({ length: 10 }),
  addressDetail: text(),
  latitude: varchar({ length: 30 }),
  longitude: varchar({ length: 30 }),
  // Contact
  phone: varchar({ length: 30 }),
  email: varchar({ length: 255 }),
  website: varchar({ length: 255 }),
  // Social
  youtubeUrl: varchar({ length: 255 }),
  facebookUrl: varchar({ length: 255 }),
  instagramUrl: varchar({ length: 255 }),
  tiktokUrl: varchar({ length: 255 }),
  // Media
  logoUrl: text(),
  bannerUrl: text(),
  // Bank
  bankName: varchar({ length: 100 }),
  bankAccountName: varchar({ length: 200 }),
  bankAccountNumber: varchar({ length: 50 }),
  // Narrative
  history: text(),
  vision: text(),
  mission: text(),
  // Timestamps
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

// ─── Management periods ────────────────────────────────────────────────────
export const periods = pgTable(
  'periods',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar({ length: 100 }).notNull(),
    startDate: timestamp({ withTimezone: true }).notNull(),
    endDate: timestamp({ withTimezone: true }),
    isActive: boolean().default(false).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index().on(t.tenantId),
  }),
);

// ─── Positions (hierarchical) ──────────────────────────────────────────────
export const positions = pgTable(
  'positions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid().references((): AnyPgColumn => positions.id),
    name: varchar({ length: 200 }).notNull(),
    sortOrder: integer().default(0).notNull(),
    description: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index().on(t.tenantId),
    parentIdx: index().on(t.parentId),
  }),
);

// ─── Officers ──────────────────────────────────────────────────────────────
export const officers = pgTable(
  'officers',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    periodId: uuid()
      .notNull()
      .references(() => periods.id),
    positionId: uuid()
      .notNull()
      .references(() => positions.id),
    name: varchar({ length: 200 }).notNull(),
    photoUrl: text(),
    phone: varchar({ length: 30 }),
    email: varchar({ length: 255 }),
    bio: text(),
    sortOrder: integer().default(0).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index().on(t.tenantId),
    periodIdx: index().on(t.periodId),
    positionIdx: index().on(t.positionId),
  }),
);

// ─── Officer documents (SK uploads) ────────────────────────────────────────
export const officerDocuments = pgTable(
  'officer_documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    officerId: uuid()
      .notNull()
      .references(() => officers.id, { onDelete: 'cascade' }),
    title: varchar({ length: 200 }).notNull(),
    fileUrl: text().notNull(),
    fileSize: integer(),
    mimeType: varchar({ length: 100 }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    officerIdx: index().on(t.officerId),
  }),
);

export type Period = typeof periods.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type Officer = typeof officers.$inferSelect;
