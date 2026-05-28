/**
 * HTML templates for PDF rendering.
 *
 * One template per report type. Each returns a full HTML document string
 * (with inline CSS) that puppeteer renders to PDF. Indonesian number/date
 * formatting via shared helpers in `format.ts`.
 */
import type {
  ActivityData,
  BalanceSheetData,
  CashFlowData,
  GeneralLedgerData,
  JurnalUmumData,
  NetAssetsChangeData,
  ReportResponse,
  ReportType,
  TrialBalanceData,
} from '../types.js';
import { REPORT_TITLES_ID, escapeHtml, formatIDR } from './format.js';

// ─── Layout shell ──────────────────────────────────────────────────────────
const SHELL_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #111827; margin: 0; padding: 24px 28px; }
  h1 { font-size: 16px; margin: 0 0 4px 0; }
  h2 { font-size: 13px; margin: 16px 0 6px 0; padding-bottom: 4px; border-bottom: 1px solid #d1d5db; }
  .meta { color: #6b7280; font-size: 10px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 12px 0; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  th { text-align: left; background: #f9fafb; font-weight: 600; font-size: 10px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 700; border-top: 2px solid #111827; border-bottom: 2px solid #111827; }
  tr.subtotal td { font-weight: 600; background: #f3f4f6; }
  .footer { margin-top: 18px; color: #9ca3af; font-size: 9px; text-align: right; }
`;

function shell(reportType: ReportType, periodLabel: string, body: string, generatedAt: string): string {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"/>
<title>${escapeHtml(REPORT_TITLES_ID[reportType])}</title>
<style>${SHELL_CSS}</style>
</head><body>
  <h1>${escapeHtml(REPORT_TITLES_ID[reportType])}</h1>
  <div class="meta">Periode: ${escapeHtml(periodLabel)} · Dibuat: ${escapeHtml(new Date(generatedAt).toLocaleString('id-ID'))}</div>
  ${body}
  <div class="footer">MasjidMu · Halaman 1</div>
</body></html>`;
}

// ─── Per-report renderers ──────────────────────────────────────────────────

function renderBalanceSheet(d: BalanceSheetData, hasCmp: boolean): string {
  const col = (label: string) => hasCmp ? `<th class="num">${escapeHtml(label)}</th><th class="num">Pembanding</th>` : `<th class="num">${escapeHtml(label)}</th>`;
  const cell = (a: string, c?: string) => hasCmp ? `<td class="num">${formatIDR(a)}</td><td class="num">${c != null ? formatIDR(c) : '-'}</td>` : `<td class="num">${formatIDR(a)}</td>`;
  const section = (s: typeof d.assets) => `
    <h2>${escapeHtml(s.label)}</h2>
    <table><thead><tr><th>Kode</th><th>Nama Akun</th>${col('Saldo')}</tr></thead><tbody>
      ${s.lines.map((l) => `<tr><td>${escapeHtml(l.accountCode)}</td><td>${escapeHtml(l.accountName)}</td>${cell(l.amount, l.compareAmount)}</tr>`).join('')}
      <tr class="total"><td colspan="2">Total ${escapeHtml(s.label)}</td>${cell(s.total, s.compareTotal)}</tr>
    </tbody></table>`;
  return `
    ${section(d.assets)}
    ${section(d.liabilities)}
    ${section(d.netAssets)}
    <table><tbody><tr class="total"><td>Total Liabilitas + Aset Neto</td>${cell(d.totalLiabilitiesAndNetAssets, d.compareTotalLiabilitiesAndNetAssets)}</td></tr></tbody></table>`;
}

function renderActivity(d: ActivityData, hasCmp: boolean): string {
  const col = hasCmp ? `<th class="num">Periode</th><th class="num">Pembanding</th>` : `<th class="num">Jumlah</th>`;
  const cell = (a: string, c?: string) => hasCmp ? `<td class="num">${formatIDR(a)}</td><td class="num">${c != null ? formatIDR(c) : '-'}</td>` : `<td class="num">${formatIDR(a)}</td>`;
  const section = (s: typeof d.income) => `
    <h2>${escapeHtml(s.label)}</h2>
    <table><thead><tr><th>Kode</th><th>Akun</th>${col}</tr></thead><tbody>
      ${s.lines.map((l) => `<tr><td>${escapeHtml(l.accountCode)}</td><td>${escapeHtml(l.accountName)}</td>${cell(l.amount, l.compareAmount)}</tr>`).join('')}
      <tr class="total"><td colspan="2">Total ${escapeHtml(s.label)}</td>${cell(s.total, s.compareTotal)}</tr>
    </tbody></table>`;
  return `
    ${section(d.income)}
    ${section(d.expense)}
    <table><tbody><tr class="total"><td>Surplus / Defisit</td>${cell(d.surplusDeficit, d.compareSurplusDeficit)}</td></tr></tbody></table>`;
}

function renderNetAssetsChange(d: NetAssetsChangeData, hasCmp: boolean): string {
  const cell = (a: string, c?: string) => hasCmp ? `<td class="num">${formatIDR(a)}</td><td class="num">${c != null ? formatIDR(c) : '-'}</td>` : `<td class="num">${formatIDR(a)}</td>`;
  const col = hasCmp ? `<th class="num">Periode</th><th class="num">Pembanding</th>` : `<th class="num">Jumlah</th>`;
  return `
    <h2>Ringkasan</h2>
    <table><thead><tr><th>Komponen</th>${col}</tr></thead><tbody>
      <tr><td>Saldo Awal</td>${cell(d.openingBalance, d.compareOpeningBalance)}</tr>
      <tr><td>Surplus / Defisit Periode</td>${cell(d.surplusDeficit, d.compareSurplusDeficit)}</tr>
      <tr class="total"><td>Saldo Akhir</td>${cell(d.closingBalance, d.compareClosingBalance)}</tr>
    </tbody></table>
    <h2>Per Akun Ekuitas</h2>
    <table><thead><tr><th>Kode</th><th>Akun</th><th class="num">Awal</th><th class="num">Pergerakan</th><th class="num">Akhir</th></tr></thead><tbody>
      ${d.byEquityAccount.map((e) => `<tr><td>${escapeHtml(e.accountCode)}</td><td>${escapeHtml(e.accountName)}</td><td class="num">${formatIDR(e.opening)}</td><td class="num">${formatIDR(e.movement)}</td><td class="num">${formatIDR(e.closing)}</td></tr>`).join('')}
    </tbody></table>`;
}

function renderCashFlow(d: CashFlowData, hasCmp: boolean): string {
  const cell = (a: string, c?: string) => hasCmp ? `<td class="num">${formatIDR(a)}</td><td class="num">${c != null ? formatIDR(c) : '-'}</td>` : `<td class="num">${formatIDR(a)}</td>`;
  const col = hasCmp ? `<th class="num">Periode</th><th class="num">Pembanding</th>` : `<th class="num">Jumlah</th>`;
  const section = (label: string, s: typeof d.operating) => `
    <h2>${escapeHtml(label)}</h2>
    <table><thead><tr><th>Deskripsi</th>${col}</tr></thead><tbody>
      ${s.lines.length > 0
        ? s.lines.map((l) => `<tr><td>${escapeHtml(l.description)}</td>${cell(l.amount, l.compareAmount)}</tr>`).join('')
        : '<tr><td colspan="' + (hasCmp ? 3 : 2) + '"><em>Tidak ada aktivitas</em></td></tr>'}
      <tr class="subtotal"><td>Subtotal ${escapeHtml(label)}</td>${cell(s.total, s.compareTotal)}</tr>
    </tbody></table>`;
  return `
    ${section('Operasi', d.operating)}
    ${section('Investasi', d.investing)}
    ${section('Pendanaan', d.financing)}
    <table><tbody>
      <tr><td>Kenaikan/Penurunan Kas Bersih</td>${cell(d.netCashChange, d.compareNetCashChange)}</tr>
      <tr><td>Kas Awal Periode</td>${cell(d.openingCash, d.compareOpeningCash)}</tr>
      <tr class="total"><td>Kas Akhir Periode</td>${cell(d.closingCash, d.compareClosingCash)}</tr>
    </tbody></table>`;
}

function renderGeneralLedger(d: GeneralLedgerData): string {
  return d.accounts.map((a) => `
    <h2>${escapeHtml(a.accountCode)} — ${escapeHtml(a.accountName)}</h2>
    <table><thead><tr><th>Tanggal</th><th>No Jurnal</th><th>Deskripsi</th><th class="num">Debit</th><th class="num">Kredit</th><th class="num">Saldo</th></tr></thead><tbody>
      <tr class="subtotal"><td colspan="5">Saldo Awal</td><td class="num">${formatIDR(a.openingBalance)}</td></tr>
      ${a.lines.map((l) => `<tr><td>${escapeHtml(l.journalDate)}</td><td>${escapeHtml(l.journalNo)}</td><td>${escapeHtml(l.description ?? '')}</td><td class="num">${formatIDR(l.debit)}</td><td class="num">${formatIDR(l.credit)}</td><td class="num">${formatIDR(l.runningBalance)}</td></tr>`).join('')}
      <tr class="total"><td colspan="5">Saldo Akhir</td><td class="num">${formatIDR(a.closingBalance)}</td></tr>
    </tbody></table>
  `).join('') || '<p><em>Tidak ada akun aktif untuk periode ini.</em></p>';
}

function renderTrialBalance(d: TrialBalanceData): string {
  return `
    <table><thead><tr><th>Kode</th><th>Akun</th><th>Tipe</th><th class="num">Debit</th><th class="num">Kredit</th></tr></thead><tbody>
      ${d.lines.map((l) => `<tr><td>${escapeHtml(l.accountCode)}</td><td>${escapeHtml(l.accountName)}</td><td>${escapeHtml(l.accountType)}</td><td class="num">${formatIDR(l.debit)}</td><td class="num">${formatIDR(l.credit)}</td></tr>`).join('')}
      <tr class="total"><td colspan="3">Total</td><td class="num">${formatIDR(d.totalDebit)}</td><td class="num">${formatIDR(d.totalCredit)}</td></tr>
    </tbody></table>`;
}

function renderJurnalUmum(d: JurnalUmumData): string {
  return `
    <table><thead><tr><th>Tanggal</th><th>No Jurnal</th><th>Deskripsi</th><th>Akun</th><th class="num">Debit</th><th class="num">Kredit</th></tr></thead><tbody>
      ${d.lines.map((l) => `<tr><td>${escapeHtml(l.journalDate)}</td><td>${escapeHtml(l.journalNo)}</td><td>${escapeHtml(l.description ?? '')}</td><td>${escapeHtml(l.accountCode)} ${escapeHtml(l.accountName)}</td><td class="num">${formatIDR(l.debit)}</td><td class="num">${formatIDR(l.credit)}</td></tr>`).join('')}
      <tr class="total"><td colspan="4">Total</td><td class="num">${formatIDR(d.totalDebit)}</td><td class="num">${formatIDR(d.totalCredit)}</td></tr>
    </tbody></table>`;
}

// ─── Dispatcher ────────────────────────────────────────────────────────────
export function renderReportHtml<T>(response: ReportResponse<T>): string {
  const hasCmp = !!response.comparePeriod;
  let body = '';
  switch (response.reportType) {
    case 'posisi-keuangan':
      body = renderBalanceSheet(response.data as unknown as BalanceSheetData, hasCmp);
      break;
    case 'aktivitas':
      body = renderActivity(response.data as unknown as ActivityData, hasCmp);
      break;
    case 'perubahan-aset-neto':
      body = renderNetAssetsChange(response.data as unknown as NetAssetsChangeData, hasCmp);
      break;
    case 'arus-kas':
      body = renderCashFlow(response.data as unknown as CashFlowData, hasCmp);
      break;
    case 'general-ledger':
      body = renderGeneralLedger(response.data as unknown as GeneralLedgerData);
      break;
    case 'trial-balance':
      body = renderTrialBalance(response.data as unknown as TrialBalanceData);
      break;
    case 'jurnal-umum':
      body = renderJurnalUmum(response.data as unknown as JurnalUmumData);
      break;
  }
  return shell(response.reportType, response.period.label, body, response.generatedAt);
}
