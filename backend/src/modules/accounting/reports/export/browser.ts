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
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
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

/**
 * Screenshots `html` at a fixed width with height driven by actual content
 * (`fullPage: true`) rather than a guessed fixed height -- avoids both
 * clipped content and empty trailing space.
 */
export async function renderPngFromHtml(html: string, width: number): Promise<Buffer> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height: 800 });
    await page.setContent(html, { waitUntil: 'load' });
    const png = await page.screenshot({ type: 'png', fullPage: true });
    return Buffer.from(png);
  } finally {
    await page.close();
  }
}
