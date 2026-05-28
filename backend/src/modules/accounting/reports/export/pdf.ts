/**
 * PDF renderer — uses puppeteer with the bundled Chromium to convert HTML
 * to A4 PDF. A single browser instance is reused across calls; pages are
 * created and closed per request.
 *
 * In dev, the first invocation triggers Chromium download (~150 MB) — see
 * `puppeteer install` postinstall. Subsequent runs reuse the cached binary.
 */
import type { Browser } from 'puppeteer';
import puppeteer from 'puppeteer';
import type { ReportResponse } from '../types.js';
import { renderReportHtml } from './html.js';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

export async function renderReportPdf<T>(response: ReportResponse<T>): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const html = renderReportHtml(response);
    await page.setContent(html, { waitUntil: 'load' });
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

/** Shut down the cached browser. Call from tests or graceful shutdown. */
export async function closeReportPdfBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
