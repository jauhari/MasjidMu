/**
 * Shared Puppeteer browser instance — reused by every export that needs
 * headless Chromium (PDF, PNG). One Chromium process only; pages are
 * created and closed per request.
 */
import type { Browser } from 'puppeteer';
import puppeteer from 'puppeteer';

let browserPromise: Promise<Browser> | null = null;

export async function getSharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

/** Shut down the cached browser. Call from tests or graceful shutdown. */
export async function closeSharedBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

export async function renderPngFromHtml(
  html: string,
  viewport: { width: number; height: number },
): Promise<Buffer> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport(viewport);
    await page.setContent(html, { waitUntil: 'load' });
    const png = await page.screenshot({ type: 'png' });
    return Buffer.from(png);
  } finally {
    await page.close();
  }
}
