import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants, users } from './core.js';

/**
 * Audit log: every CRUD on business tables, every auth event.
 *
 * Will be partitioned monthly (`pg_partman` or manual fallback) and archived
 * to R2 after 12 months per PRD retention policy.
 *
 * RLS enabled — but read access is gated to permission `audit_logs.read`.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid().references(() => tenants.id, { onDelete: 'set null' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: varchar({ length: 100 }).notNull(),
    resource: varchar({ length: 100 }),
    resourceId: uuid(),
    ipAddress: varchar({ length: 45 }),
    userAgent: text(),
    metadata: jsonb(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantTimeIdx: index().on(t.tenantId, t.createdAt),
    userIdx: index().on(t.userId),
    actionIdx: index().on(t.action),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
