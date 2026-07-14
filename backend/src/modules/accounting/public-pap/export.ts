import type { Browser } from 'puppeteer';
import puppeteer from 'puppeteer';
import type { PublicPapReportResponse } from './types.js';

let browserPromise: Promise<Browser> | null = null;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value: string): string {
  const n = Number(value);
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function dateId(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

export function renderPublicPapHtml(report: PublicPapReportResponse): string {
  const rows = report.data.movements.map((m) => `
    <tr>
      <td>${m.sequence}</td>
      <td>${escapeHtml(dateId(m.date))}</td>
      <td>${escapeHtml(m.label)}</td>
      <td class="num ${m.direction === 'penerimaan' ? 'in' : ''}">${m.direction === 'penerimaan' ? escapeHtml(money(m.amount)) : '-'}</td>
      <td class="num ${m.direction === 'penyaluran' ? 'out' : ''}">${m.direction === 'penyaluran' ? escapeHtml(money(m.amount)) : '-'}</td>
      <td class="num">${escapeHtml(money(m.runningBalance))}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Laporan Dana PAP - ${escapeHtml(report.mosque.name)}</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; color: #17211d; margin: 0; }
    .page { padding: 28px; }
    .eyebrow { color: #047857; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 8px 0 4px; font-size: 26px; }
    .muted { color: #6b756f; font-size: 12px; }
    .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 22px 0; }
    .card { border: 1px solid #dfe7e2; border-radius: 12px; padding: 12px; background: #fbfdfb; }
    .label { color: #6b756f; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    .value { margin-top: 5px; font-size: 18px; font-weight: 750; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 11px; }
    th { background: #f2f6f3; color: #46534c; text-align: left; }
    th, td { border-bottom: 1px solid #e5ece7; padding: 8px; vertical-align: top; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .in { color: #047857; }
    .out { color: #b45309; }
    .note { margin-top: 18px; border: 1px solid #dfe7e2; border-radius: 10px; padding: 10px; color: #526158; font-size: 11px; background: #f8fbf9; }
  </style>
</head>
<body>
  <main class="page">
    <div class="eyebrow">Laporan Transparansi Dana PAP</div>
    <h1>${escapeHtml(report.mosque.name)}</h1>
    <div class="muted">Periode ${escapeHtml(report.period.label)} · Dipublikasikan ${escapeHtml(dateId(report.publication.publishedAt))} · Dibuat ${escapeHtml(dateId(report.generatedAt))}</div>

    <section class="cards">
      <div class="card"><div class="label">Saldo awal</div><div class="value">${escapeHtml(money(report.data.openingBalance))}</div></div>
      <div class="card"><div class="label">Penerimaan</div><div class="value in">${escapeHtml(money(report.data.totalPenerimaan))}</div></div>
      <div class="card"><div class="label">Penyaluran</div><div class="value out">${escapeHtml(money(report.data.totalPenyaluran))}</div></div>
      <div class="card"><div class="label">Saldo akhir</div><div class="value">${escapeHtml(money(report.data.closingBalance))}</div></div>
    </section>

    <table>
      <thead><tr><th>No</th><th>Tanggal</th><th>Aktivitas</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Saldo</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">Belum ada mutasi pada periode ini.</td></tr>'}</tbody>
    </table>

    <p class="note">Detail internal seperti nama donatur/penerima, nomor bukti, akun, referensi, dan catatan audit sengaja tidak dipublikasikan untuk menjaga privasi. Angka berasal dari transaksi Dana PAP yang sudah diposting.</p>
  </main>
</body>
</html>`;
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  }
  return browserPromise;
}

export async function renderPublicPapPdf(report: PublicPapReportResponse): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(renderPublicPapHtml(report), { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
