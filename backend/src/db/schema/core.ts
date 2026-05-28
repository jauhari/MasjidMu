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

// ─── Users (app-side profile) ──────────────────────────────────────────────
/**
 * App-side user profile. Authentication is handled by better-auth in its
 * own `user` table (schema/auth.ts). This table mirrors per-tenant context
 * and any business-domain fields. `authUserId` references better-auth's
 * `user.id` (text), populated by `ensureUserMapping()` on sign-in.
 */
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    authUserId: text().notNull(), // FK to auth.user.id (text, no Drizzle ref to avoid cross-schema cycle)
    email: varchar({ length: 255 }).notNull(),
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
    uniqueTenantAuth: unique().on(t.tenantId, t.authUserId),
    tenantIdx: index().on(t.tenantId),
    authUserIdx: index().on(t.authUserId),
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

// ─── Sessions ──────────────────────────────────────────────────────────────
// Sessions are managed by better-auth in `auth.session` (schema/auth.ts).
// No app-side mirror needed — query `auth.session` directly when listing
// active sessions in admin UI.

export type User = typeof users.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
