/**
 * Shared types for accounting modules.
 *
 * These mirror the Drizzle pgEnum values exactly — keep in sync with
 * src/db/schema/accounting.ts.
 */
export type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'income'
  | 'expense'
  | 'contra_asset'
  | 'contra_liability';

export type NormalBalance = 'debit' | 'credit';

export type TransactionStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'posted';

export type TransactionDirection = 'income' | 'expense';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'skipped';
