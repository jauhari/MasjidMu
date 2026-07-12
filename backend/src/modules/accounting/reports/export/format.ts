/**
 * Shared formatting helpers for report exporters.
 */
import type { ReportType } from '../types.js';

export const REPORT_TITLES_ID: Record<ReportType, string> = {
  'posisi-keuangan': 'Laporan Posisi Keuangan',
  aktivitas: 'Laporan Aktivitas',
  'perubahan-aset-neto': 'Laporan Perubahan Aset Neto',
  'arus-kas': 'Laporan Arus Kas',
  'general-ledger': 'Buku Besar (General Ledger)',
  'trial-balance': 'Neraca Saldo (Trial Balance)',
  'jurnal-umum': 'Jurnal Umum',
  'sumber-penggunaan-dana': 'Laporan Sumber & Penggunaan Dana',
  'buku-dana': 'Buku Dana (Detail Penerimaan & Penyaluran)',
  'konsolidasi-dana': 'Laporan Konsolidasi Sumber & Penggunaan Dana',
};

/** Format `1234567.89` → `1.234.567,89` (Indonesian convention). */
export function formatIDR(amount: string | number): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return String(amount);
  const fixed = Math.abs(n).toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withSep = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = n < 0 ? '-' : '';
  return `${sign}${withSep},${decPart}`;
}

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
