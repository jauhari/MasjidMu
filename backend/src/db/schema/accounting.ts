import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './core.js';

// ─── Enums (English values; UI shows Indonesian labels) ────────────────────
export const accountTypeEnum = pgEnum('account_type', [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
  'contra_asset',
  'contra_liability',
]);

export const normalBalanceEnum = pgEnum('normal_balance', ['debit', 'credit']);

export const transactionStatusEnum = pgEnum('transaction_status', [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'posted',
]);

export const transactionDirectionEnum = pgEnum('transaction_direction', [
  'income',
  'expense',
]);

export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'approved',
  'rejected',
  'skipped',
]);

// Fund dimension for PSAK 109 (zakat/infak-sedekah/amil/non-halal) and
// PSAK 112 (wakaf). 'umum' = general operating fund used by the masjid /
// generic non-profit (ISAK 35) edition where dana segregation isn't required.
export const fundTypeEnum = pgEnum('fund_type', [
  'zakat',
  'infaq_sedekah',
  'amil',
  'nonhalal',
  'wakaf',
  'umum',
]);

// ─── Chart of Accounts ─────────────────────────────────────────────────────
export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid().references((): AnyPgColumn => accounts.id),
    code: varchar({ length: 20 }).notNull(),
    name: varchar({ length: 200 }).notNull(),
    accountType: accountTypeEnum().notNull(),
    normalBalance: normalBalanceEnum().notNull(),
    description: text(),
    isActive: boolean().default(true).notNull(),
    isSystem: boolean().default(false).notNull(),
    openingBalance: numeric({ precision: 18, scale: 2 }).default('0').notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    uniqueTenantCode: unique().on(t.tenantId, t.code),
    tenantIdx: index().on(t.tenantId),
    parentIdx: index().on(t.parentId),
  }),
);

// ─── Funds (Dana) — PSAK 109 / PSAK 112 fund accounting ────────────────────
// Each posting line is tagged with a fund so we can produce a per-fund
// "Laporan Sumber & Penggunaan Dana". A tenant on the masjid/ISAK-35 edition
// only ever uses the single 'umum' fund; the ZakatMu edition enforces a
// non-null fund at the application layer.
export const funds = pgTable(
  'funds',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: varchar({ length: 20 }).notNull(),
    name: varchar({ length: 200 }).notNull(),
    fundType: fundTypeEnum().notNull(),
    // Terikat/restricted use (zakat & wakaf are restricted by syariah).
    isRestricted: boolean().default(false).notNull(),
    description: text(),
    isActive: boolean().default(true).notNull(),
    isSystem: boolean().default(false).notNull(),
    sortOrder: integer().default(0).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    uniqueTenantCode: unique().on(t.tenantId, t.code),
    tenantIdx: index().on(t.tenantId),
  }),
);

// ─── Transaction Categories (link kategori → COA mapping) ──────────────────
// Optional defaultFundId: one-tap template for LAZ programs (e.g. "Infaq PAP"
// → debit Kas PAP, credit Infaq, fund PAP 2026).
export const transactionCategories = pgTable(
  'transaction_categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: varchar({ length: 50 }).notNull(),
    name: varchar({ length: 200 }).notNull(),
    direction: transactionDirectionEnum().notNull(),
    debitAccountId: uuid().references(() => accounts.id),
    creditAccountId: uuid().references(() => accounts.id),
    defaultFundId: uuid().references(() => funds.id, { onDelete: 'set null' }),
    isActive: boolean().default(true).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    uniqueTenantCode: unique().on(t.tenantId, t.code),
    tenantIdx: index().on(t.tenantId),
  }),
);

// ─── Transactions ──────────────────────────────────────────────────────────
export const transactions = pgTable(
  'transactions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    transactionNo: varchar({ length: 50 }).notNull(),
    transactionDate: timestamp({ withTimezone: true }).notNull(),
    categoryId: uuid().references(() => transactionCategories.id),
    amount: numeric({ precision: 18, scale: 2 }).notNull(),
    description: text(),
    referenceNo: varchar({ length: 100 }),
    status: transactionStatusEnum().default('draft').notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    submittedAt: timestamp({ withTimezone: true }),
    submittedBy: uuid().references(() => users.id),
    postedAt: timestamp({ withTimezone: true }),
    postedBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    uniqueTenantNo: unique().on(t.tenantId, t.transactionNo),
    tenantDateIdx: index().on(t.tenantId, t.transactionDate),
    statusIdx: index().on(t.status),
    amountPositive: check('tx_amount_positive', sql`${t.amount} > 0`),
  }),
);

export const transactionLines = pgTable(
  'transaction_lines',
  {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    // Nullable: masjid/ISAK-35 edition leaves it null (single 'umum' fund);
    // ZakatMu edition enforces non-null per PSAK 109 at the app layer.
    fundId: uuid().references(() => funds.id),
    debit: numeric({ precision: 18, scale: 2 }).default('0').notNull(),
    credit: numeric({ precision: 18, scale: 2 }).default('0').notNull(),
    description: text(),
    sortOrder: integer().default(0).notNull(),
  },
  (t) => ({
    txIdx: index().on(t.transactionId),
    accountIdx: index().on(t.accountId),
    fundIdx: index().on(t.fundId),
    debitNonNeg: check('tl_debit_non_neg', sql`${t.debit} >= 0`),
    creditNonNeg: check('tl_credit_non_neg', sql`${t.credit} >= 0`),
    debitXorCredit: check(
      'tl_debit_xor_credit',
      sql`(${t.debit} > 0 AND ${t.credit} = 0) OR (${t.debit} = 0 AND ${t.credit} > 0)`,
    ),
  }),
);

// ─── Approval workflow ─────────────────────────────────────────────────────
export const approvalStages = pgTable(
  'approval_stages',
  {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    stageOrder: integer().notNull(),
    requiredPermission: varchar({ length: 100 }).notNull(),
    status: approvalStatusEnum().default('pending').notNull(),
    approvedBy: uuid().references(() => users.id),
    approvedAt: timestamp({ withTimezone: true }),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    txIdx: index().on(t.transactionId),
    uniqueTxOrder: unique().on(t.transactionId, t.stageOrder),
  }),
);

export const approvalLogs = pgTable(
  'approval_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    stageId: uuid().references(() => approvalStages.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    action: varchar({ length: 50 }).notNull(),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    txIdx: index().on(t.transactionId),
  }),
);

// ─── Journals ──────────────────────────────────────────────────────────────
export const journals = pgTable(
  'journals',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    journalNo: varchar({ length: 50 }).notNull(),
    journalDate: timestamp({ withTimezone: true }).notNull(),
    transactionId: uuid().references(() => transactions.id),
    description: text(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueTenantNo: unique().on(t.tenantId, t.journalNo),
    tenantDateIdx: index().on(t.tenantId, t.journalDate),
    txIdx: index().on(t.transactionId),
  }),
);

export const accountingImportBatches = pgTable(
  'accounting_import_batches',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    importType: varchar({ length: 50 }).notNull(),
    sourceType: varchar({ length: 20 }),
    sourceFingerprint: varchar({ length: 64 }).notNull(),
    payloadFingerprint: varchar({ length: 64 }).notNull(),
    fundId: uuid().references(() => funds.id),
    reason: text(),
    rowCount: integer().notNull(),
    importedCount: integer(),
    status: varchar({ length: 20 }).default('processing').notNull(),
    result: jsonb().$type<Record<string, unknown> | null>(),
    error: text(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    committedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    uniqueTenantSource: unique().on(t.tenantId, t.importType, t.sourceFingerprint),
    tenantStatusIdx: index().on(t.tenantId, t.status),
    payloadIdx: index().on(t.payloadFingerprint),
    validStatus: check('accounting_import_batch_status_check', sql`${t.status} IN ('processing', 'committed', 'failed')`),
  }),
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid().primaryKey().defaultRandom(),
    journalId: uuid()
      .notNull()
      .references(() => journals.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    // Fund dimension carried from the transaction to the posted ledger so
    // PSAK 109 per-dana reports read straight from journal lines.
    fundId: uuid().references(() => funds.id),
    debit: numeric({ precision: 18, scale: 2 }).default('0').notNull(),
    credit: numeric({ precision: 18, scale: 2 }).default('0').notNull(),
    description: text(),
    sortOrder: integer().default(0).notNull(),
  },
  (t) => ({
    journalIdx: index().on(t.journalId),
    accountIdx: index().on(t.accountId),
    fundIdx: index().on(t.fundId),
    debitNonNeg: check('jl_debit_non_neg', sql`${t.debit} >= 0`),
    creditNonNeg: check('jl_credit_non_neg', sql`${t.credit} >= 0`),
    debitXorCredit: check(
      'jl_debit_xor_credit',
      sql`(${t.debit} > 0 AND ${t.credit} = 0) OR (${t.debit} = 0 AND ${t.credit} > 0)`,
    ),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type Fund = typeof funds.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type TransactionLine = typeof transactionLines.$inferSelect;
export type Journal = typeof journals.$inferSelect;
export type JournalLine = typeof journalLines.$inferSelect;
export type AccountingImportBatch = typeof accountingImportBatches.$inferSelect;
