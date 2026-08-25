import { renderPngFromHtml } from '../reports/export/browser.js';
import type { PublicFinanceReportResponse } from './types.js';

const CARD_WIDTH = 1080;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function formatRupiah(amount: string): string {
  const n = Math.round(Number(amount));
  return `Rp${n.toLocaleString('id-ID')}`;
}

const ICONS = {
  wallet: `<svg viewBox="0 0 40 40" width="30" height="30"><rect x="3" y="9" width="34" height="24" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M3 16 H37" stroke="currentColor" stroke-width="3"/><circle cx="29" cy="24" r="2.5" fill="currentColor"/></svg>`,
  up: `<svg viewBox="0 0 40 40" width="26" height="26"><polyline points="5,28 16,17 22,23 35,10" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="25,10 35,10 35,20" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  down: `<svg viewBox="0 0 40 40" width="26" height="26"><polyline points="5,12 16,23 22,17 35,30" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="25,30 35,30 35,20" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  link: `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};

function avatarHtml(mosque: PublicFinanceReportResponse['mosque']): string {
  if (mosque.logoUrl) {
    return `<img class="avatar" src="${escapeHtml(mosque.logoUrl)}" alt="" />`;
  }
  const initial = (mosque.shortName || mosque.name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<div class="avatar avatar-fallback">${escapeHtml(initial)}</div>`;
}

function categoryBlock(
  cat: PublicFinanceReportResponse['data']['topIncome'][number] | undefined,
  emptyLabel: string,
): string {
  if (!cat) {
    return `<p class="cat-empty">${escapeHtml(emptyLabel)}</p>`;
  }
  return `<p class="cat-name">${escapeHtml(cat.categoryName)}</p><p class="cat-amount">${formatRupiah(cat.amount)}</p>`;
}

const MONTH_ABBR_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const TREND_MONTHS = 6;

function trendChartHtml(trend: PublicFinanceReportResponse['data']['monthlyTrend']): string {
  const recent = trend.slice(-TREND_MONTHS);
  if (recent.length < 2) return '';
  const maxValue = Math.max(1, ...recent.map((m) => Math.max(Number(m.income), Number(m.expense))));
  const cols = recent
    .map((m) => {
      const [, mm] = m.month.split('-');
      const label = MONTH_ABBR_ID[Number(mm) - 1];
      const incomeH = Math.max(2, Math.round((Number(m.income) / maxValue) * 100));
      const expenseH = Math.max(2, Math.round((Number(m.expense) / maxValue) * 100));
      return `<div class="trend-col">
        <div class="trend-bars">
          <div class="trend-bar income" style="height:${incomeH}%"></div>
          <div class="trend-bar expense" style="height:${expenseH}%"></div>
        </div>
        <div class="trend-label">${escapeHtml(label)}</div>
      </div>`;
    })
    .join('');
  return `<div class="card">
    <div class="stat-label" style="margin-bottom: 22px;">Tren ${recent.length} Bulan Terakhir</div>
    <div class="trend-chart">${cols}</div>
  </div>`;
}

export function renderPublicFinanceHtml(report: PublicFinanceReportResponse, publicUrl: string): string {
  const hasIncome = report.data.topIncome.length > 0;
  const hasExpense = report.data.topExpense.length > 0;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #eef4f0; }
  body {
    width: ${CARD_WIDTH}px;
    font-family: 'Segoe UI', 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif;
    color: #16241c;
  }
  .sheet { background: #ffffff; }
  .header {
    background: linear-gradient(135deg, #0f9d6e 0%, #0a7a56 100%);
    padding: 56px 64px 44px;
    color: #ffffff;
  }
  .brand-row { display: flex; align-items: center; gap: 22px; }
  .avatar {
    width: 84px; height: 84px; border-radius: 22px; object-fit: cover;
    background: rgba(255,255,255,0.16);
  }
  .avatar-fallback {
    display: flex; align-items: center; justify-content: center;
    font-size: 36px; font-weight: 800; color: #ffffff;
  }
  .kicker {
    font-size: 20px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
    color: rgba(255,255,255,0.78); margin-bottom: 6px;
  }
  .org-name { font-size: 42px; font-weight: 800; line-height: 1.15; }
  .period-pill {
    display: inline-block; margin-top: 22px; padding: 9px 20px;
    background: rgba(255,255,255,0.16); border-radius: 999px;
    font-size: 21px; font-weight: 600; color: #ffffff;
  }
  .body { padding: 44px 64px 8px; }
  .card {
    background: #ffffff; border: 1px solid #e6ede9; border-radius: 28px;
    padding: 32px 36px; box-shadow: 0 1px 3px rgba(15,40,28,0.05);
  }
  .card + .card { margin-top: 22px; }
  .icon-badge {
    width: 56px; height: 56px; border-radius: 16px;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 18px;
  }
  .icon-badge.cash { background: #e3f3ec; color: #0f9d6e; }
  .icon-badge.income { background: #e3f3ec; color: #0f9d6e; }
  .icon-badge.expense { background: #fbe9e0; color: #c1591f; }
  .stat-label { font-size: 21px; font-weight: 600; color: #5b6b62; margin-bottom: 8px; }
  .stat-main { font-size: 52px; font-weight: 800; color: #16241c; letter-spacing: -0.01em; }
  .grid-2 { display: flex; gap: 22px; margin-top: 22px; }
  .grid-2 .card { flex: 1; margin-top: 0; }
  .cat-name { font-size: 26px; font-weight: 700; color: #16241c; line-height: 1.3; margin-bottom: 6px; }
  .cat-amount { font-size: 34px; font-weight: 800; }
  .income .cat-amount { color: #0f9d6e; }
  .expense .cat-amount { color: #c1591f; }
  .cat-empty { font-size: 22px; font-style: italic; color: #93a29a; }
  .trend-chart { display: flex; align-items: flex-end; gap: 20px; height: 200px; }
  .trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
  .trend-bars { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 8px; }
  .trend-bar { width: 22px; border-radius: 6px 6px 0 0; }
  .trend-bar.income { background: #34b980; }
  .trend-bar.expense { background: #e08a4a; }
  .trend-label { margin-top: 14px; font-size: 18px; font-weight: 600; color: #5b6b62; }
  .footer {
    margin-top: 40px; padding: 32px 64px 44px; text-align: center;
    border-top: 1px solid #e6ede9;
  }
  .footer-label { font-size: 20px; color: #5b6b62; margin-bottom: 12px; }
  .footer-link {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 12px 26px; border-radius: 999px; border: 1.5px solid #0f9d6e;
    color: #0a7a56; font-weight: 700; font-size: 20px;
  }
  .watermark { margin-top: 22px; font-size: 16px; color: #a6b3ac; }
</style></head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="brand-row">
        ${avatarHtml(report.mosque)}
        <div>
          <div class="kicker">Transparansi Keuangan</div>
          <div class="org-name">${escapeHtml(report.mosque.name)}</div>
        </div>
      </div>
      <div class="period-pill">Periode: ${escapeHtml(report.period.label)}</div>
    </div>

    <div class="body">
      <div class="card">
        <div class="icon-badge cash">${ICONS.wallet}</div>
        <div class="stat-label">Posisi Kas Saat Ini</div>
        <div class="stat-main">${formatRupiah(report.data.cashPosition)}</div>
      </div>

      <div class="grid-2">
        <div class="card income">
          <div class="icon-badge income">${ICONS.up}</div>
          <div class="stat-label">Pemasukan Terbesar</div>
          ${categoryBlock(report.data.topIncome[0], hasIncome ? '' : 'Belum ada transaksi tercatat')}
        </div>
        <div class="card expense">
          <div class="icon-badge expense">${ICONS.down}</div>
          <div class="stat-label">Pengeluaran Terbesar</div>
          ${categoryBlock(report.data.topExpense[0], hasExpense ? '' : 'Belum ada transaksi tercatat')}
        </div>
      </div>

      ${trendChartHtml(report.data.monthlyTrend)}
    </div>

    <div class="footer">
      <div class="footer-label">Lihat rincian lengkap</div>
      <div class="footer-link">${ICONS.link}<span>${escapeHtml(publicUrl.replace(/^https?:\/\//, ''))}</span></div>
      <div class="watermark">Dibuat otomatis oleh MizanMu &middot; ${escapeHtml(new Date(report.generatedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }))}</div>
    </div>
  </div>
</body></html>`;
}

export async function renderPublicFinanceImage(
  report: PublicFinanceReportResponse,
  publicUrl: string,
): Promise<Buffer> {
  const html = renderPublicFinanceHtml(report, publicUrl);
  return renderPngFromHtml(html, CARD_WIDTH);
}
