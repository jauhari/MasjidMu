import { renderPdfFromHtml } from '../reports/export/browser.js';
import type { PublicFinanceReportResponse } from './types.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function formatRupiah(amount: string | number): string {
  const n = Math.round(Number(amount));
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function formatSigned(amount: string | number): string {
  const n = Math.round(Number(amount));
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}Rp ${Math.abs(n).toLocaleString('id-ID')}`;
}

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const MONTH_ABBR_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "2026-08-04" -> "04 Agu 2026" (string math: no timezone to get wrong). */
function formatDateShort(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d} ${MONTH_ABBR_ID[Number(m) - 1] ?? m} ${y}`;
}

export function renderPublicFinancePdfHtml(
  report: PublicFinanceReportResponse,
  publicUrl: string,
  isAllTime: boolean,
  tenantSlug: string = '',
): string {
  const mosqueName = report.mosque.name || 'Lembaga';
  const periodLabel = report.period.label || 'Seluruh Waktu';
  const today = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const isPcaPonjong =
    tenantSlug === 'pca-ponjong' ||
    mosqueName.toLowerCase().includes('pca ponjong') ||
    mosqueName.toLowerCase().includes('aisyiyah cabang ponjong');

  const leaderName = isPcaPonjong ? 'Umi Fadhilah' : '( &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; )';
  const treasurerName = isPcaPonjong ? 'Iva Fitria' : '( &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; )';

  const trend = report.data.monthlyTrend ?? [];
  const byMonth = new Map(trend.map((m) => [m.month, m]));
  const years = [...new Set(trend.map((m) => Number(m.month.slice(0, 4))))].sort((a, b) => a - b);

  const annualSummary = years.map((y) => {
    let yearIncome = 0;
    let yearExpense = 0;
    const months = Array.from({ length: 12 }, (_, i) => {
      const key = `${y}-${String(i + 1).padStart(2, '0')}`;
      const found = byMonth.get(key);
      const inc = Number(found?.income ?? 0);
      const exp = Number(found?.expense ?? 0);
      yearIncome += inc;
      yearExpense += exp;
      return {
        monthName: MONTH_NAMES_ID[i]!,
        income: inc,
        expense: exp,
        net: inc - exp,
      };
    });
    return {
      year: y,
      totalIncome: yearIncome,
      totalExpense: yearExpense,
      totalNet: yearIncome - yearExpense,
      months,
    };
  });

  const grandIncome = annualSummary.reduce((acc, y) => acc + y.totalIncome, 0);
  const grandExpense = annualSummary.reduce((acc, y) => acc + y.totalExpense, 0);
  const grandNet = grandIncome - grandExpense;

  const annualSummaryRows = annualSummary
    .map(
      (y) => `
      <tr>
        <td style="font-weight: 600;">Tahun ${y.year}</td>
        <td style="text-align: right; color: #047857; font-weight: 600;">${formatRupiah(y.totalIncome)}</td>
        <td style="text-align: right; color: #b45309; font-weight: 600;">${formatRupiah(y.totalExpense)}</td>
        <td style="text-align: right; font-weight: 700; ${y.totalNet >= 0 ? 'color: #047857;' : 'color: #b91c1c;'}">${formatSigned(y.totalNet)}</td>
      </tr>`,
    )
    .join('');

  const incomeCatRows = report.data.topIncome.length
    ? report.data.topIncome
        .map(
          (c) => `
        <tr>
          <td>${escapeHtml(c.categoryName)}</td>
          <td style="text-align: right; font-weight: 600; color: #047857;">${formatRupiah(c.amount)}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td colspan="2" style="text-align: center; color: #6b7280; font-style: italic;">Belum ada data pemasukan</td></tr>`;

  const expenseCatRows = report.data.topExpense.length
    ? report.data.topExpense
        .map(
          (c) => `
        <tr>
          <td>${escapeHtml(c.categoryName)}</td>
          <td style="text-align: right; font-weight: 600; color: #b45309;">${formatRupiah(c.amount)}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td colspan="2" style="text-align: center; color: #6b7280; font-style: italic;">Belum ada data pengeluaran</td></tr>`;

  // Buku Kas: the same TGL | Keterangan | Masuk | Keluar | Saldo layout as the
  // handwritten cash book members are used to, with Saldo awal / Jumlah rows.
  const ledger = report.data.ledger;
  const ledgerRows = ledger.entries.length
    ? ledger.entries
        .map(
          (e, idx) => `
        <tr style="${idx % 2 === 1 ? 'background: #f9fafb;' : ''}">
          <td class="nowrap" style="color: #4b5563; font-size: 11px;">${escapeHtml(formatDateShort(e.date))}</td>
          <td>${escapeHtml(e.keterangan)}</td>
          <td class="num" style="color: #047857;">${Number(e.masuk) > 0 ? formatRupiah(e.masuk) : ''}</td>
          <td class="num" style="color: #b45309;">${Number(e.keluar) > 0 ? formatRupiah(e.keluar) : ''}</td>
          <td class="num" style="font-weight: 600;">${formatRupiah(e.saldo)}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td colspan="5" style="text-align: center; color: #6b7280; font-style: italic; padding: 14px;">Belum ada transaksi kas pada periode ini</td></tr>`;

  const ledgerSection = `
  <div style="margin-top: 14px;">
    <div class="section-head">Buku Kas — ${escapeHtml(periodLabel)}</div>
    <table class="report-table ledger">
      <thead>
        <tr>
          <th style="width: 14%;">Tanggal</th>
          <th style="width: 36%;">Keterangan</th>
          <th style="width: 16.6%; text-align: right;">Masuk</th>
          <th style="width: 16.6%; text-align: right;">Keluar</th>
          <th style="width: 16.8%; text-align: right;">Saldo</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background: #f3f4f6; font-weight: 700;">
          <td></td>
          <td>Saldo awal</td>
          <td></td>
          <td></td>
          <td class="num">${formatRupiah(ledger.openingBalance)}</td>
        </tr>
        ${ledgerRows}
        <tr style="background: #e5e7eb; font-weight: 800; border-top: 2px solid #111827;">
          <td></td>
          <td>Jumlah</td>
          <td class="num" style="color: #047857;">${formatRupiah(ledger.totalMasuk)}</td>
          <td class="num" style="color: #b45309;">${formatRupiah(ledger.totalKeluar)}</td>
          <td class="num">${formatRupiah(ledger.closingBalance)}</td>
        </tr>
      </tbody>
    </table>
    ${
      ledger.truncated
        ? `<div style="font-size: 10.5px; color: #6b7280; font-style: italic;">Hanya ${ledger.entries.length} baris pertama yang ditampilkan — persempit periode untuk melihat sisanya.</div>`
        : ''
    }
  </div>`;

  const monthlyTables = isAllTime && annualSummary.length
    ? annualSummary
        .slice()
        .reverse()
        .map(
          (y) => `
        <div style="margin-top: 18px; page-break-inside: avoid;">
          <h4 style="font-size: 13px; font-weight: 700; color: #1f2937; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em;">
            Rincian Bulanan — Tahun ${y.year}
          </h4>
          <table class="report-table">
            <thead>
              <tr>
                <th style="width: 35%;">Bulan</th>
                <th style="width: 22%; text-align: right;">Pemasukan</th>
                <th style="width: 22%; text-align: right;">Pengeluaran</th>
                <th style="width: 21%; text-align: right;">Selisih</th>
              </tr>
            </thead>
            <tbody>
              ${y.months
                .map(
                  (m, i) => `
                <tr style="${i % 2 === 1 ? 'background: #f9fafb;' : ''}">
                  <td>${m.monthName}</td>
                  <td style="text-align: right; color: #047857;">${formatRupiah(m.income)}</td>
                  <td style="text-align: right; color: #b45309;">${formatRupiah(m.expense)}</td>
                  <td style="text-align: right; font-weight: 600; ${m.net >= 0 ? 'color: #047857;' : 'color: #b91c1c;'}">${formatSigned(m.net)}</td>
                </tr>`,
                )
                .join('')}
              <tr style="background: #f3f4f6; font-weight: 700; border-top: 2px solid #374151;">
                <td>Total Tahun ${y.year}</td>
                <td style="text-align: right; color: #047857;">${formatRupiah(y.totalIncome)}</td>
                <td style="text-align: right; color: #b45309;">${formatRupiah(y.totalExpense)}</td>
                <td style="text-align: right; ${y.totalNet >= 0 ? 'color: #047857;' : 'color: #b91c1c;'}">${formatSigned(y.totalNet)}</td>
              </tr>
            </tbody>
          </table>
        </div>`,
        )
        .join('')
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Laporan Transparansi Keuangan - ${escapeHtml(mosqueName)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm 12mm 14mm 12mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Times New Roman', Times, Georgia, serif;
      color: #111827;
      background: #ffffff;
      font-size: 12px;
      line-height: 1.45;
    }
    .kop-surat {
      text-align: center;
      padding-bottom: 12px;
      border-bottom: 3px double #111827;
      margin-bottom: 16px;
    }
    .kop-org {
      font-size: 19px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #065f46;
    }
    .kop-sub {
      font-size: 11px;
      color: #4b5563;
      margin-top: 2px;
      font-family: Arial, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .doc-title {
      text-align: center;
      margin-bottom: 16px;
    }
    .doc-title h2 {
      font-size: 15px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      text-decoration: underline;
    }
    .doc-title p {
      font-size: 12px;
      color: #374151;
      margin-top: 3px;
      font-style: italic;
    }
    .summary-grid {
      display: table;
      width: 100%;
      table-layout: fixed;
      margin-bottom: 16px;
      border: 1px solid #d1d5db;
      border-collapse: collapse;
      background: #fafafa;
    }
    .summary-col {
      display: table-cell;
      padding: 10px 14px;
      border: 1px solid #d1d5db;
      text-align: center;
    }
    .summary-label {
      font-size: 10.5px;
      font-family: Arial, sans-serif;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #4b5563;
      margin-bottom: 4px;
    }
    .summary-val {
      font-size: 15px;
      font-weight: 800;
      font-family: Arial, sans-serif;
      color: #111827;
    }
    .report-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-family: Arial, sans-serif;
      font-size: 11.5px;
    }
    .report-table th {
      background: #e5e7eb;
      color: #111827;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 10.5px;
      letter-spacing: 0.03em;
      padding: 6px 8px;
      border: 1px solid #9ca3af;
      text-align: left;
    }
    .report-table td {
      padding: 6px 8px;
      border: 1px solid #d1d5db;
    }
    .report-table .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .report-table .nowrap { white-space: nowrap; }
    /* Buku Kas can run to many pages: repeat the header, never split a row. */
    .ledger thead { display: table-header-group; }
    .ledger tr { page-break-inside: avoid; }
    .columns-2 {
      display: table;
      width: 100%;
      table-layout: fixed;
      margin-bottom: 14px;
      page-break-inside: avoid;
    }
    .col-left {
      display: table-cell;
      width: 50%;
      padding-right: 8px;
      vertical-align: top;
    }
    .col-right {
      display: table-cell;
      width: 50%;
      padding-left: 8px;
      vertical-align: top;
    }
    .section-head {
      font-family: Arial, sans-serif;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #1f2937;
      margin-bottom: 6px;
    }
    .signature-section {
      margin-top: 28px;
      page-break-inside: avoid;
      font-family: Arial, sans-serif;
    }
    .sig-date {
      text-align: right;
      margin-bottom: 18px;
      font-size: 12px;
    }
    .sig-table {
      width: 100%;
      table-layout: fixed;
    }
    .sig-box {
      text-align: center;
      vertical-align: top;
      padding: 0 10px;
    }
    .sig-role {
      font-weight: 700;
      font-size: 12px;
      margin-bottom: 55px;
    }
    .sig-name {
      font-weight: 700;
      text-decoration: underline;
      font-size: 12px;
    }
    .footer-note {
      margin-top: 24px;
      padding-top: 8px;
      border-top: 1px solid #e5e7eb;
      font-family: Arial, sans-serif;
      font-size: 9.5px;
      color: #6b7280;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="kop-surat">
    <div class="kop-org">${escapeHtml(mosqueName)}</div>
    <div class="kop-sub">Sistem Tata Kelola &amp; Laporan Transparansi Keuangan Terpadu</div>
  </div>

  <div class="doc-title">
    <h2>Laporan Transparansi Keuangan</h2>
    <p>Periode: ${escapeHtml(periodLabel)}</p>
  </div>

  <div class="summary-grid">
    <div class="summary-col">
      <div class="summary-label">Posisi Kas Saat Ini</div>
      <div class="summary-val" style="color: #065f46;">${formatRupiah(report.data.cashPosition)}</div>
    </div>
    <div class="summary-col">
      <div class="summary-label">Pemasukan Terbesar</div>
      <div class="summary-val" style="color: #047857; font-size: 13px;">
        ${report.data.topIncome[0] ? escapeHtml(report.data.topIncome[0].categoryName) : '—'}
      </div>
      <div style="font-size: 12px; font-weight: bold; color: #047857; font-family: Arial, sans-serif;">
        ${report.data.topIncome[0] ? formatRupiah(report.data.topIncome[0].amount) : 'Rp 0'}
      </div>
    </div>
    <div class="summary-col">
      <div class="summary-label">Pengeluaran Terbesar</div>
      <div class="summary-val" style="color: #b45309; font-size: 13px;">
        ${report.data.topExpense[0] ? escapeHtml(report.data.topExpense[0].categoryName) : '—'}
      </div>
      <div style="font-size: 12px; font-weight: bold; color: #b45309; font-family: Arial, sans-serif;">
        ${report.data.topExpense[0] ? formatRupiah(report.data.topExpense[0].amount) : 'Rp 0'}
      </div>
    </div>
  </div>

  <!-- Category Breakdown (2 columns) -->
  <div class="columns-2">
    <div class="col-left">
      <div class="section-head">Kategori Pemasukan</div>
      <table class="report-table">
        <thead>
          <tr>
            <th>Kategori</th>
            <th style="width: 35%; text-align: right;">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          ${incomeCatRows}
        </tbody>
      </table>
    </div>
    <div class="col-right">
      <div class="section-head">Kategori Pengeluaran</div>
      <table class="report-table">
        <thead>
          <tr>
            <th>Kategori</th>
            <th style="width: 35%; text-align: right;">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          ${expenseCatRows}
        </tbody>
      </table>
    </div>
  </div>

  ${
    isAllTime
      ? `
  <!-- All-Time Annual Recap -->
  <div style="margin-top: 14px; page-break-inside: avoid;">
    <div class="section-head">Rekapitulasi Keuangan Per Tahun</div>
    <table class="report-table">
      <thead>
        <tr>
          <th style="width: 25%;">Tahun Buku</th>
          <th style="width: 25%; text-align: right;">Total Pemasukan</th>
          <th style="width: 25%; text-align: right;">Total Pengeluaran</th>
          <th style="width: 25%; text-align: right;">Surplus / (Defisit)</th>
        </tr>
      </thead>
      <tbody>
        ${annualSummaryRows}
        <tr style="background: #e5e7eb; font-weight: 800; border-top: 2px solid #111827; font-size: 12px;">
          <td>Total Akumulasi Seluruh Waktu</td>
          <td style="text-align: right; color: #047857;">${formatRupiah(grandIncome)}</td>
          <td style="text-align: right; color: #b45309;">${formatRupiah(grandExpense)}</td>
          <td style="text-align: right; ${grandNet >= 0 ? 'color: #047857;' : 'color: #b91c1c;'}">${formatSigned(grandNet)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Detailed Monthly breakdown tables per year -->
  ${monthlyTables}
  `
      : ''
  }

  <!-- Buku Kas: every period, including all-time (after the monthly recap) -->
  ${ledgerSection}

  <!-- Formal Signatures -->
  <div class="signature-section">
    <div class="sig-date">
      Ditetapkan pada: ${today}
    </div>
    <table class="sig-table">
      <tr>
        <td class="sig-box">
          <div class="sig-role">Mengetahui,<br>Pimpinan / Ketua</div>
          <div class="sig-name">${leaderName}</div>
        </td>
        <td class="sig-box">
          <div class="sig-role">Pengelola Keuangan,<br>Bendahara</div>
          <div class="sig-name">${treasurerName}</div>
        </td>
      </tr>
    </table>
  </div>

  <div class="footer-note">
    <div>Diterbitkan secara resmi melalui platform MizanMu &middot; Tautan verifikasi: ${escapeHtml(publicUrl)}</div>
    <div>Dokumen Sah</div>
  </div>
</body>
</html>`;
}

export async function renderPublicFinancePdf(
  report: PublicFinanceReportResponse,
  publicUrl: string,
  isAllTime: boolean,
  tenantSlug: string = '',
): Promise<Buffer> {
  const html = renderPublicFinancePdfHtml(report, publicUrl, isAllTime, tenantSlug);
  return renderPdfFromHtml(html);
}
