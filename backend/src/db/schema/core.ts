import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Tenants = masjid (one tenant per mosque).
 * Identified by `slug` (used in subdomain routing: `{slug}.masjidmu.id`).
 *
 * RLS NOT enabled on this table — needed for tenant resolution before context is set.
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
