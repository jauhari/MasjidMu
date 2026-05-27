import { env } from './env.js';
import { logger } from './logger.js';

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Send a Markdown message to the configured Telegram chat.
 *
 * Fire-and-forget: failures are logged but never thrown — alerting must not
 * break a request path. Returns true if the message was sent.
 */
export async function sendTelegram(text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return false;
  }

  try {
    const res = await fetch(
      `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) {
      logger.warn({ status: res.status }, 'telegram send failed');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, 'telegram send threw');
    return false;
  }
}

/** Convenience: send an alert with severity prefix. */
export async function alertTelegram(
  severity: 'info' | 'warn' | 'error' | 'critical',
  title: string,
  details?: Record<string, unknown>,
): Promise<boolean> {
  const emoji = { info: 'ℹ️', warn: '⚠️', error: '🔴', critical: '🚨' }[severity];
  const lines = [
    `${emoji} *${severity.toUpperCase()}* — ${title}`,
    `\`env: ${env.NODE_ENV}\``,
  ];
  if (details && Object.keys(details).length > 0) {
    lines.push('```', JSON.stringify(details, null, 2).slice(0, 1500), '```');
  }
  return sendTelegram(lines.join('\n'));
}
