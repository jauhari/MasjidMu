/**
 * XLSX renderer — uses exceljs to write one workbook per report. Each report
 * type uses its own column shape. Numbers are written as JS numbers (not
 * formatted strings) so users can re-aggregate in Excel.
 *
 * Indonesian number format applied via cell.numFmt.
 */
import ExcelJS from 'exceljs';
import type {
  ActivityData,
  BalanceSheetData,
  CashFlowData,
  ConsolidatedFundUsageData,
  FundUsageData,
  GeneralLedgerData,
  JurnalUmumData,
  NetAssetsChangeData,
  ReportResponse,
  TrialBalanceData,
} from '../types.js';
import { REPORT_TITLES_ID } from './format.js';

const NUM_FMT = '#,##0.00;-#,##0.00;-';

function num(s: string | undefined | null): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function addHeader(ws: ExcelJS.Worksheet, title: string, periodLabel: string, generatedAt: string): void {
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([`Periode: ${periodLabel}`]);
  ws.addRow([`Dibuat: ${new Date(generatedAt).toLocaleString('id-ID')}`]);
  ws.addRow([]);
}

// ─── Per-report builders ──────────────────────────────────────────────────

function buildBalanceSheet(wb: ExcelJS.Workbook, r: ReportResponse<BalanceSheetData>): void {
  const ws = wb.addWorksheet('Posisi Keuangan');
  addHeader(ws, REPORT_TITLES_ID['posisi-keuangan'], r.period.label, r.generatedAt);
  const hasCmp = !!r.comparePeriod;
  const headers = hasCmp
    ? ['Kode', 'Nama Akun', 'Saldo', 'Pembanding']
    : ['Kode', 'Nama Akun', 'Saldo'];
  const writeSection = (s: BalanceSheetData['assets']) => {
    ws.addRow([s.label]).font = { bold: true };
    ws.addRow(headers).font = { bold: true };
    for (const l of s.lines) {
      const row = hasCmp
        ? [l.accountCode, l.accountName, num(l.amount), num(l.compareAmount)]
        : [l.accountCode, l.accountName, num(l.amount)];
      ws.addRow(row);
    }
    const totalRow = hasCmp
      ? ['', `Total ${s.label}`, num(s.total), num(s.compareTotal)]
      : ['', `Total ${s.label}`, num(s.total)];
    ws.addRow(totalRow).font = { bold: true };
    ws.addRow([]);
  };
  writeSection(r.data.assets);
  writeSection(r.data.liabilities);
  writeSection(r.data.netAssets);
  const finalRow = hasCmp
    ? ['', 'Total Liabilitas + Aset Neto', num(r.data.totalLiabilitiesAndNetAssets), num(r.data.compareTotalLiabilitiesAndNetAssets)]
    : ['', 'Total Liabilitas + Aset Neto', num(r.data.totalLiabilitiesAndNetAssets)];
  ws.addRow(finalRow).font = { bold: true };
  applyNumberFormat(ws, hasCmp ? [3, 4] : [3]);
  autoFit(ws);
}

function buildActivity(wb: ExcelJS.Workbook, r: ReportResponse<ActivityData>): void {
  const ws = wb.addWorksheet('Aktivitas');
  addHeader(ws, REPORT_TITLES_ID['aktivitas'], r.period.label, r.generatedAt);
  const hasCmp = !!r.comparePeriod;
  const headers = hasCmp
    ? ['Kode', 'Nama Akun', 'Periode', 'Pembanding']
    : ['Kode', 'Nama Akun', 'Jumlah'];
  const writeSection = (s: ActivityData['income']) => {
    ws.addRow([s.label]).font = { bold: true };
    ws.addRow(headers).font = { bold: true };
    for (const l of s.lines) {
      ws.addRow(hasCmp ? [l.accountCode, l.accountName, num(l.amount), num(l.compareAmount)] : [l.accountCode, l.accountName, num(l.amount)]);
    }
    ws.addRow(hasCmp ? ['', `Total ${s.label}`, num(s.total), num(s.compareTotal)] : ['', `Total ${s.label}`, num(s.total)]).font = { bold: true };
    ws.addRow([]);
  };
  writeSection(r.data.income);
  writeSection(r.data.expense);
  ws.addRow(hasCmp ? ['', 'Surplus / Defisit', num(r.data.surplusDeficit), num(r.data.compareSurplusDeficit)] : ['', 'Surplus / Defisit', num(r.data.surplusDeficit)]).font = { bold: true };
  applyNumberFormat(ws, hasCmp ? [3, 4] : [3]);
  autoFit(ws);
}

function buildNetAssetsChange(wb: ExcelJS.Workbook, r: ReportResponse<NetAssetsChangeData>): void {
  const ws = wb.addWorksheet('Perubahan Aset Neto');
  addHeader(ws, REPORT_TITLES_ID['perubahan-aset-neto'], r.period.label, r.generatedAt);
  const hasCmp = !!r.comparePeriod;
  ws.addRow(hasCmp ? ['Komponen', 'Periode', 'Pembanding'] : ['Komponen', 'Jumlah']).font = { bold: true };
  ws.addRow(hasCmp ? ['Saldo Awal', num(r.data.openingBalance), num(r.data.compareOpeningBalance)] : ['Saldo Awal', num(r.data.openingBalance)]);
  ws.addRow(hasCmp ? ['Surplus / Defisit Periode', num(r.data.surplusDeficit), num(r.data.compareSurplusDeficit)] : ['Surplus / Defisit Periode', num(r.data.surplusDeficit)]);
  ws.addRow(hasCmp ? ['Saldo Akhir', num(r.data.closingBalance), num(r.data.compareClosingBalance)] : ['Saldo Akhir', num(r.data.closingBalance)]).font = { bold: true };
  ws.addRow([]);
  ws.addRow(['Per Akun Ekuitas']).font = { bold: true };
  ws.addRow(['Kode', 'Akun', 'Awal', 'Pergerakan', 'Akhir']).font = { bold: true };
  for (const e of r.data.byEquityAccount) {
    ws.addRow([e.accountCode, e.accountName, num(e.opening), num(e.movement), num(e.closing)]);
  }
  applyNumberFormat(ws, hasCmp ? [2, 3] : [2]);
  applyNumberFormat(ws, [3, 4, 5]);
  autoFit(ws);
}

function buildCashFlow(wb: ExcelJS.Workbook, r: ReportResponse<CashFlowData>): void {
  const ws = wb.addWorksheet('Arus Kas');
  addHeader(ws, REPORT_TITLES_ID['arus-kas'], r.period.label, r.generatedAt);
  const hasCmp = !!r.comparePeriod;
  const headers = hasCmp ? ['Deskripsi', 'Periode', 'Pembanding'] : ['Deskripsi', 'Jumlah'];
  const writeSection = (label: string, s: CashFlowData['operating']) => {
    ws.addRow([label]).font = { bold: true };
    ws.addRow(headers).font = { bold: true };
    if (s.lines.length === 0) {
      ws.addRow([hasCmp ? 'Tidak ada aktivitas' : 'Tidak ada aktivitas']);
    } else {
      for (const l of s.lines) {
        ws.addRow(hasCmp ? [l.description, num(l.amount), num(l.compareAmount)] : [l.description, num(l.amount)]);
      }
    }
    ws.addRow(hasCmp ? [`Subtotal ${label}`, num(s.total), num(s.compareTotal)] : [`Subtotal ${label}`, num(s.total)]).font = { bold: true };
    ws.addRow([]);
  };
  writeSection('Operasi', r.data.operating);
  writeSection('Investasi', r.data.investing);
  writeSection('Pendanaan', r.data.financing);
  ws.addRow(hasCmp ? ['Kenaikan/Penurunan Kas Bersih', num(r.data.netCashChange), num(r.data.compareNetCashChange)] : ['Kenaikan/Penurunan Kas Bersih', num(r.data.netCashChange)]);
  ws.addRow(hasCmp ? ['Kas Awal', num(r.data.openingCash), num(r.data.compareOpeningCash)] : ['Kas Awal', num(r.data.openingCash)]);
  ws.addRow(hasCmp ? ['Kas Akhir', num(r.data.closingCash), num(r.data.compareClosingCash)] : ['Kas Akhir', num(r.data.closingCash)]).font = { bold: true };
  applyNumberFormat(ws, hasCmp ? [2, 3] : [2]);
  autoFit(ws);
}

function buildGeneralLedger(wb: ExcelJS.Workbook, r: ReportResponse<GeneralLedgerData>): void {
  const ws = wb.addWorksheet('Buku Besar');
  addHeader(ws, REPORT_TITLES_ID['general-ledger'], r.period.label, r.generatedAt);
  for (const a of r.data.accounts) {
    ws.addRow([`${a.accountCode} — ${a.accountName}`]).font = { bold: true };
    ws.addRow(['Tanggal', 'No Jurnal', 'Deskripsi', 'Debit', 'Kredit', 'Saldo']).font = { bold: true };
    ws.addRow(['', '', 'Saldo Awal', null, null, num(a.openingBalance)]);
    for (const l of a.lines) {
      ws.addRow([l.journalDate, l.journalNo, l.description ?? '', num(l.debit), num(l.credit), num(l.runningBalance)]);
    }
    ws.addRow(['', '', 'Saldo Akhir', null, null, num(a.closingBalance)]).font = { bold: true };
    ws.addRow([]);
  }
  applyNumberFormat(ws, [4, 5, 6]);
  autoFit(ws);
}

function buildTrialBalance(wb: ExcelJS.Workbook, r: ReportResponse<TrialBalanceData>): void {
  const ws = wb.addWorksheet('Neraca Saldo');
  addHeader(ws, REPORT_TITLES_ID['trial-balance'], r.period.label, r.generatedAt);
  ws.addRow(['Kode', 'Akun', 'Tipe', 'Debit', 'Kredit']).font = { bold: true };
  for (const l of r.data.lines) {
    ws.addRow([l.accountCode, l.accountName, l.accountType, num(l.debit), num(l.credit)]);
  }
  ws.addRow(['', '', 'Total', num(r.data.totalDebit), num(r.data.totalCredit)]).font = { bold: true };
  applyNumberFormat(ws, [4, 5]);
  autoFit(ws);
}

function buildJurnalUmum(wb: ExcelJS.Workbook, r: ReportResponse<JurnalUmumData>): void {
  const ws = wb.addWorksheet('Jurnal Umum');
  addHeader(ws, REPORT_TITLES_ID['jurnal-umum'], r.period.label, r.generatedAt);
  ws.addRow(['Tanggal', 'No Jurnal', 'Deskripsi', 'Kode', 'Akun', 'Debit', 'Kredit']).font = { bold: true };
  for (const l of r.data.lines) {
    ws.addRow([l.journalDate, l.journalNo, l.description ?? '', l.accountCode, l.accountName, num(l.debit), num(l.credit)]);
  }
  ws.addRow(['', '', '', '', 'Total', num(r.data.totalDebit), num(r.data.totalCredit)]).font = { bold: true };
  applyNumberFormat(ws, [6, 7]);
  autoFit(ws);
}

function buildFundUsage(wb: ExcelJS.Workbook, r: ReportResponse<FundUsageData>): void {
  const ws = wb.addWorksheet('Sumber & Penggunaan Dana');
  addHeader(ws, REPORT_TITLES_ID['sumber-penggunaan-dana'], r.period.label, r.generatedAt);
  ws.addRow(['Dana', 'Saldo Awal', 'Penerimaan', 'Penyaluran', 'Surplus/(Defisit)', 'Saldo Akhir']).font =
    { bold: true };
  for (const f of r.data.funds) {
    ws.addRow([
      `${f.fundName}${f.isRestricted ? ' *' : ''}`,
      num(f.openingBalance),
      num(f.penerimaan),
      num(f.penyaluran),
      num(f.surplusDeficit),
      num(f.closingBalance),
    ]);
  }
  ws.addRow([
    'Total',
    num(r.data.totalOpening),
    num(r.data.totalPenerimaan),
    num(r.data.totalPenyaluran),
    num(r.data.totalSurplusDeficit),
    num(r.data.totalClosing),
  ]).font = { bold: true };
  applyNumberFormat(ws, [2, 3, 4, 5, 6]);
  autoFit(ws);
}

function buildConsolidatedFundUsage(wb: ExcelJS.Workbook, r: ReportResponse<ConsolidatedFundUsageData>): void {
  const d = r.data;
  const ws = wb.addWorksheet('Konsolidasi Dana');
  addHeader(ws, REPORT_TITLES_ID['konsolidasi-dana'], r.period.label, r.generatedAt);

  ws.addRow([`${d.entityCount} entitas (induk + cabang)`]);
  ws.addRow([]);
  ws.addRow(['Ringkasan per Entitas']).font = { bold: true };
  ws.addRow(['Entitas', 'Penerimaan', 'Penyaluran', 'Saldo Akhir']).font = { bold: true };
  for (const e of d.entities) {
    ws.addRow([e.tenantName, num(e.penerimaan), num(e.penyaluran), num(e.closingBalance)]);
  }
  applyNumberFormat(ws, [2, 3, 4]);

  ws.addRow([]);
  ws.addRow(['Konsolidasi per Jenis Dana']).font = { bold: true };
  const head = ws.addRow(['Dana', 'Saldo Awal', 'Penerimaan', 'Penyaluran', 'Surplus/(Defisit)', 'Saldo Akhir']);
  head.font = { bold: true };
  for (const f of d.byFundType) {
    ws.addRow([f.label, num(f.openingBalance), num(f.penerimaan), num(f.penyaluran), num(f.surplusDeficit), num(f.closingBalance)]);
  }
  ws.addRow([
    'Total Konsolidasi',
    num(d.totalOpening),
    num(d.totalPenerimaan),
    num(d.totalPenyaluran),
    num(d.totalSurplusDeficit),
    num(d.totalClosing),
  ]).font = { bold: true };
  // Format kolom angka pada blok jenis dana (kolom 2-6).
  applyNumberFormat(ws, [2, 3, 4, 5, 6]);
  autoFit(ws);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function applyNumberFormat(ws: ExcelJS.Worksheet, cols: number[]): void {
  for (const c of cols) {
    ws.getColumn(c).numFmt = NUM_FMT;
  }
}

function autoFit(ws: ExcelJS.Worksheet): void {
  ws.columns.forEach((col) => {
    let maxLen = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value == null ? '' : String(cell.value);
      if (v.length > maxLen) maxLen = v.length;
    });
    col.width = Math.min(maxLen + 2, 40);
  });
}

// ─── Dispatcher ───────────────────────────────────────────────────────────

export async function renderReportXlsx<T>(response: ReportResponse<T>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HisabMu';
  wb.created = new Date(response.generatedAt);

  switch (response.reportType) {
    case 'posisi-keuangan':
      buildBalanceSheet(wb, response as unknown as ReportResponse<BalanceSheetData>);
      break;
    case 'aktivitas':
      buildActivity(wb, response as unknown as ReportResponse<ActivityData>);
      break;
    case 'perubahan-aset-neto':
      buildNetAssetsChange(wb, response as unknown as ReportResponse<NetAssetsChangeData>);
      break;
    case 'arus-kas':
      buildCashFlow(wb, response as unknown as ReportResponse<CashFlowData>);
      break;
    case 'general-ledger':
      buildGeneralLedger(wb, response as unknown as ReportResponse<GeneralLedgerData>);
      break;
    case 'trial-balance':
      buildTrialBalance(wb, response as unknown as ReportResponse<TrialBalanceData>);
      break;
    case 'jurnal-umum':
      buildJurnalUmum(wb, response as unknown as ReportResponse<JurnalUmumData>);
      break;
    case 'sumber-penggunaan-dana':
      buildFundUsage(wb, response as unknown as ReportResponse<FundUsageData>);
      break;
    case 'konsolidasi-dana':
      buildConsolidatedFundUsage(wb, response as unknown as ReportResponse<ConsolidatedFundUsageData>);
      break;
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
