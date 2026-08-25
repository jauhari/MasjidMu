import { renderPngFromHtml } from '../reports/export/browser.js';
import type { PublicFinanceReportResponse } from './types.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function formatRupiah(amount: string): string {
  const n = Math.round(Number(amount));
  return `Rp${n.toLocaleString('id-ID')}`;
}

function categoryLine(cat: PublicFinanceReportResponse['data']['topIncome'][number] | undefined): string {
  if (!cat) return '<div class="cat-name">Belum ada data</div>';
  return `<div class="cat-name">${escapeHtml(cat.categoryName)}</div><div class="cat-amount">${formatRupiah(cat.amount)}</div>`;
}

export function renderPublicFinanceHtml(report: PublicFinanceReportResponse, publicUrl: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; }
  body { width: 1080px; height: 1350px; background: linear-gradient(180deg, #f8fbf9 0%, #eef4ef 100%); padding: 64px; color: #1a2e22; }
  .brand { display: flex; align-items: center; gap: 24px; margin-bottom: 48px; }
  .brand img { width: 88px; height: 88px; border-radius: 24px; object-fit: cover; }
  .brand-name { font-size: 40px; font-weight: 800; }
  .kicker { font-size: 22px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #0d9467; margin-bottom: 8px; }
  .period { font-size: 26px; color: #4b5f54; margin-top: 60px; margin-bottom: 24px; }
  .card { background: #fff; border-radius: 32px; padding: 40px 48px; margin-bottom: 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  .card-label { font-size: 24px; color: #5c6b62; font-weight: 600; margin-bottom: 12px; }
  .card-main { font-size: 56px; font-weight: 800; }
  .cat-name { font-size: 30px; font-weight: 700; }
  .cat-amount { font-size: 44px; font-weight: 800; margin-top: 6px; }
  .income .cat-amount { color: #0d9467; }
  .expense .cat-amount { color: #b3541e; }
  .footer { margin-top: 48px; font-size: 22px; color: #5c6b62; text-align: center; }
  .footer .url { font-weight: 700; color: #0d9467; }
</style></head>
<body>
  <div class="brand">
    ${report.mosque.logoUrl ? `<img src="${escapeHtml(report.mosque.logoUrl)}" />` : ''}
    <div>
      <div class="kicker">Transparansi Keuangan</div>
      <div class="brand-name">${escapeHtml(report.mosque.name)}</div>
    </div>
  </div>
  <div class="period">Periode: ${escapeHtml(report.period.label)}</div>
  <div class="card">
    <div class="card-label">Posisi Kas Saat Ini</div>
    <div class="card-main">${formatRupiah(report.data.cashPosition)}</div>
  </div>
  <div class="card income">
    <div class="card-label">Pemasukan Terbesar</div>
    ${categoryLine(report.data.topIncome[0])}
  </div>
  <div class="card expense">
    <div class="card-label">Pengeluaran Terbesar</div>
    ${categoryLine(report.data.topExpense[0])}
  </div>
  <div class="footer">Detail lengkap di<br/><span class="url">${escapeHtml(publicUrl)}</span></div>
</body></html>`;
}

export async function renderPublicFinanceImage(
  report: PublicFinanceReportResponse,
  publicUrl: string,
): Promise<Buffer> {
  const html = renderPublicFinanceHtml(report, publicUrl);
  return renderPngFromHtml(html, { width: 1080, height: 1350 });
}
