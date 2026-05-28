/**
 * Shared types for the reports module.
 *
 * Period encodes either a calendar month (year+month) or a custom date range.
 * `comparePeriod` is optional and follows the same shape — when present,
 * services emit comparative columns alongside the main period.
 */

export type ReportType =
  | 'posisi-keuangan'
  | 'aktivitas'
  | 'perubahan-aset-neto'
  | 'arus-kas'
  | 'general-ledger'
  | 'trial-balance'
  | 'jurnal-umum';

export type ExportFormat = 'json' | 'pdf' | 'xlsx';

/** Inclusive date range. `startDate` and `endDate` are UTC midnights. */
export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface ReportPeriod extends DateRange {
  /** Human-readable label, e.g. "Mei 2026" or "1 Mei 2026 – 28 Mei 2026". */
  label: string;
  /** First day of period_month bucket for materialized view lookups. */
  periodMonth: Date;
}

export interface ReportRequest {
  period: ReportPeriod;
  comparePeriod?: ReportPeriod;
}

/** Common envelope returned by every JSON report endpoint. */
export interface ReportResponse<T> {
  reportType: ReportType;
  tenantId: string;
  period: ReportPeriod;
  comparePeriod?: ReportPeriod;
  generatedAt: string;
  data: T;
}

// ─── Posisi Keuangan (Balance Sheet) ──────────────────────────────────
export interface BalanceSheetLine {
  accountCode: string;
  accountName: string;
  amount: string;
  compareAmount?: string;
}

export interface BalanceSheetSection {
  label: string;
  lines: BalanceSheetLine[];
  total: string;
  compareTotal?: string;
}

export interface BalanceSheetData {
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  netAssets: BalanceSheetSection;
  totalLiabilitiesAndNetAssets: string;
  compareTotalLiabilitiesAndNetAssets?: string;
}

// ─── Aktivitas (Income Statement / Statement of Activities) ───────────
export interface ActivityLine {
  accountCode: string;
  accountName: string;
  amount: string;
  compareAmount?: string;
}

export interface ActivitySection {
  label: string;
  lines: ActivityLine[];
  total: string;
  compareTotal?: string;
}

export interface ActivityData {
  income: ActivitySection;
  expense: ActivitySection;
  surplusDeficit: string;
  compareSurplusDeficit?: string;
}

// ─── Perubahan Aset Neto ──────────────────────────────────────────────
export interface NetAssetsChangeData {
  openingBalance: string;
  surplusDeficit: string;
  closingBalance: string;
  compareOpeningBalance?: string;
  compareSurplusDeficit?: string;
  compareClosingBalance?: string;
  byEquityAccount: Array<{
    accountCode: string;
    accountName: string;
    opening: string;
    movement: string;
    closing: string;
  }>;
}

// ─── Arus Kas (Direct Method) ─────────────────────────────────────────
export interface CashFlowLine {
  description: string;
  amount: string;
  compareAmount?: string;
}

export interface CashFlowData {
  operating: { lines: CashFlowLine[]; total: string; compareTotal?: string };
  investing: { lines: CashFlowLine[]; total: string; compareTotal?: string };
  financing: { lines: CashFlowLine[]; total: string; compareTotal?: string };
  netCashChange: string;
  openingCash: string;
  closingCash: string;
  compareNetCashChange?: string;
  compareOpeningCash?: string;
  compareClosingCash?: string;
}

// ─── General Ledger ───────────────────────────────────────────────────
export interface GeneralLedgerLine {
  journalNo: string;
  journalDate: string;
  description: string | null;
  debit: string;
  credit: string;
  runningBalance: string;
}

export interface GeneralLedgerAccount {
  accountCode: string;
  accountName: string;
  openingBalance: string;
  closingBalance: string;
  lines: GeneralLedgerLine[];
}

export interface GeneralLedgerData {
  accounts: GeneralLedgerAccount[];
}

// ─── Trial Balance ────────────────────────────────────────────────────
export interface TrialBalanceLine {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: string;
  credit: string;
}

export interface TrialBalanceData {
  lines: TrialBalanceLine[];
  totalDebit: string;
  totalCredit: string;
}

// ─── Jurnal Umum ──────────────────────────────────────────────────────
export interface JurnalUmumLine {
  journalNo: string;
  journalDate: string;
  description: string | null;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
}

export interface JurnalUmumData {
  lines: JurnalUmumLine[];
  totalDebit: string;
  totalCredit: string;
}
