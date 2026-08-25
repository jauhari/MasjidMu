/**
 * PDF renderer — uses puppeteer with the bundled Chromium to convert HTML
 * to A4 PDF. A single browser instance is reused across calls; pages are
 * created and closed per request.
 *
 * In dev, the first invocation triggers Chromium download (~150 MB) — see
 * `puppeteer install` postinstall. Subsequent runs reuse the cached binary.
 */
import type { ReportResponse } from '../types.js';
import { renderReportHtml } from './html.js';
import { getSharedBrowser, closeSharedBrowser } from './browser.js';

export async function renderReportPdf<T>(response: ReportResponse<T>): Promise<Buffer> {
  const browser = await getSharedBrowser();
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
export const closeReportPdfBrowser = closeSharedBrowser;
