/**
 * Default PSAK 45 (Indonesian non-profit accounting) chart of accounts.
 *
 * Each new tenant gets this seeded automatically on creation. The hierarchy
 * uses parent.code prefix matching to derive parent_id — no explicit IDs in
 * source so the seed is portable across tenants.
 *
 * Code format: 1XXX = aset, 2XXX = kewajiban, 3XXX = aset neto,
 *              4XXX = pendapatan, 5XXX = beban.
 *
 * normal_balance follows Indonesian non-profit accounting:
 *   asset/expense   → debit
 *   liability/equity/income → credit
 */
import type { AccountType, NormalBalance } from '../types.js';

export interface DefaultAccountSpec {
  code: string;
  name: string;
  accountType: AccountType;
  /** Optional override; computed from accountType if omitted. */
  normalBalance?: NormalBalance;
  isSystem?: boolean;
}

export const PSAK_45_DEFAULT_ACCOUNTS: DefaultAccountSpec[] = [
  // ─── 1XXX Aset ─────────────────────────────────────────────────
  { code: '1000', name: 'Aset', accountType: 'asset', isSystem: true },
  { code: '1100', name: 'Aset Lancar', accountType: 'asset', isSystem: true },
  { code: '1110', name: 'Kas', accountType: 'asset' },
  { code: '1120', name: 'Bank', accountType: 'asset' },
  { code: '1130', name: 'Piutang', accountType: 'asset' },
  { code: '1140', name: 'Persediaan', accountType: 'asset' },
  { code: '1200', name: 'Aset Tetap', accountType: 'asset', isSystem: true },
  { code: '1210', name: 'Tanah', accountType: 'asset' },
  { code: '1220', name: 'Bangunan', accountType: 'asset' },
  { code: '1230', name: 'Peralatan', accountType: 'asset' },
  {
    code: '1290',
    name: 'Akumulasi Penyusutan',
    accountType: 'contra_asset',
    normalBalance: 'credit',
  },

  // ─── 2XXX Kewajiban ────────────────────────────────────────────
  { code: '2000', name: 'Kewajiban', accountType: 'liability', isSystem: true },
  { code: '2100', name: 'Kewajiban Lancar', accountType: 'liability', isSystem: true },
  { code: '2110', name: 'Utang Usaha', accountType: 'liability' },
  { code: '2120', name: 'Utang Lainnya', accountType: 'liability' },

  // ─── 3XXX Aset Neto (Equity) ──────────────────────────────────
  { code: '3000', name: 'Aset Neto', accountType: 'equity', isSystem: true },
  { code: '3100', name: 'Aset Neto Tidak Terikat', accountType: 'equity' },
  { code: '3200', name: 'Aset Neto Terikat Temporer', accountType: 'equity' },
  { code: '3300', name: 'Aset Neto Terikat Permanen', accountType: 'equity' },
  { code: '3900', name: 'Saldo Awal Aset Neto', accountType: 'equity', isSystem: true },

  // ─── 4XXX Pendapatan ───────────────────────────────────────────
  { code: '4000', name: 'Pendapatan', accountType: 'income', isSystem: true },
  { code: '4100', name: 'Infaq & Sedekah', accountType: 'income' },
  { code: '4200', name: 'Donasi Program', accountType: 'income' },
  { code: '4300', name: 'Pendapatan Operasional Lain', accountType: 'income' },
  { code: '4900', name: 'Pendapatan Lain-lain', accountType: 'income' },

  // ─── 5XXX Beban ────────────────────────────────────────────────
  { code: '5000', name: 'Beban', accountType: 'expense', isSystem: true },
  { code: '5100', name: 'Beban Operasional', accountType: 'expense' },
  { code: '5110', name: 'Beban Listrik & Air', accountType: 'expense' },
  { code: '5120', name: 'Beban Kebersihan', accountType: 'expense' },
  { code: '5130', name: 'Beban Honor Pengurus', accountType: 'expense' },
  { code: '5200', name: 'Beban Program', accountType: 'expense' },
  { code: '5300', name: 'Beban Pemeliharaan', accountType: 'expense' },
  { code: '5400', name: 'Beban Penyusutan', accountType: 'expense' },
  { code: '5900', name: 'Beban Lain-lain', accountType: 'expense' },
];

/** Normal balance lookup by account type. */
export function defaultNormalBalance(t: AccountType): NormalBalance {
  switch (t) {
    case 'asset':
    case 'expense':
      return 'debit';
    case 'liability':
    case 'equity':
    case 'income':
      return 'credit';
    case 'contra_asset':
      return 'credit';
    case 'contra_liability':
      return 'debit';
  }
}

/** Find the parent code for a given code based on hierarchy.
 *  Levels:
 *    L1: X000 (e.g. 1000)        — root
 *    L2: XY00 (e.g. 1100, 5300)  — parent = X000
 *    L3: XYZ0 (e.g. 1110, 5130)  — parent = XY00
 *
 *  Examples:
 *    '1000' → null
 *    '1100' → '1000'
 *    '1110' → '1100'
 *    '5130' → '5100'
 */
export function deriveParentCode(code: string): string | null {
  if (!/^\d{4}$/.test(code)) return null;
  if (code.endsWith('000')) return null;        // L1: root
  if (code.endsWith('00')) return code[0] + '000'; // L2: 1100 → 1000
  return code.slice(0, 2) + '00';                  // L3: 1110 → 1100
}
