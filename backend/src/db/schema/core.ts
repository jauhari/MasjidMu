import {
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Enums ─────────────────────────────────────────────────────────────────
export const userStatusEnum = pgEnum('user_status', ['active', 'inactive', 'invited']);

// ─── Tenants ───────────────────────────────────────────────────────────────
/**
 * Tenants = masjid (one tenant per mosque).
 * Identified by `slug` for subdomain routing: `{slug}.masjidmu.id`.
 *
 * RLS NOT enabled here — needed for tenant resolution before context is set.
 */
export const tenants = pgTable('tenants', {
  id: uuid().primaryKey().defaultRandom(),
  slug: varchar({ length: 63 }).notNull().unique(),
  name: varchar({ length: 200 }).notNull(),
  shortName: varchar({ length: 100 }),
  isActive: boolean().default(true).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp({ withTimezone: true }),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

// ─── Users ─────────────────────────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: varchar({ length: 255 }).notNull(),
    emailVerified: boolean().default(false).notNull(),
    passwordHash: varchar({ length: 255 }),
    name: varchar({ length: 200 }).notNull(),
    avatarUrl: text(),
    status: userStatusEnum().default('invited').notNull(),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    uniqueTenantEmail: unique().on(t.tenantId, t.email),
    tenantIdx: index().on(t.tenantId),
  }),
);

// ─── Roles & Permissions ───────────────────────────────────────────────────
/**
 * Roles can be system-wide (tenant_id NULL, like `super_admin`) or
 * tenant-scoped (one set per masjid). RLS allows tenant_id IS NULL OR matches.
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid().references(() => tenants.id, { onDelete: 'cascade' }),
    code: varchar({ length: 50 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    description: text(),
    isSystem: boolean().default(false).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueTenantCode: unique().on(t.tenantId, t.code),
  }),
);

export const permissions = pgTable('permissions', {
  id: uuid().primaryKey().defaultRandom(),
  code: varchar({ length: 100 }).notNull().unique(),
  module: varchar({ length: 50 }).notNull(),
  action: varchar({ length: 100 }).notNull(),
  description: text(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
  }),
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
  }),
);

// ─── Sessions (better-auth managed; minimal mirror for typing) ─────────────
/**
 * better-auth manages session/account tables on its own schema. This is a
 * minimal mirror for app-side queries (e.g. listing active sessions in admin
 * UI). better-auth may add more columns at runtime — that's OK; Drizzle only
 * sees the columns we declare.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    token: varchar({ length: 500 }).notNull().unique(),
    ipAddress: varchar({ length: 45 }),
    userAgent: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index().on(t.userId),
    tenantIdx: index().on(t.tenantId),
    expiresIdx: index().on(t.expiresAt),
  }),
);

export type User = typeof users.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
