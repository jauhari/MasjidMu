import { sql } from 'drizzle-orm';
import type { Tx } from '../../../db/client.js';

export type AccountingNumberKind = 'transaction' | 'journal';

export function accountingNumberPrefix(tenantSlug: string): string {
  return tenantSlug.slice(0, 4).toUpperCase().padEnd(4, 'X');
}

export function accountingNumberPattern(
  kind: AccountingNumberKind,
  tenantSlug: string,
  date: Date,
): { prefix: string; like: string } {
  const code = kind === 'transaction' ? 'TX' : 'JRN';
  const month = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const prefix = `${code}-${accountingNumberPrefix(tenantSlug)}-${month}-`;
  return { prefix, like: `${prefix}%` };
}

export function nextAccountingSequence(lastNumber: string | null): number {
  if (!lastNumber) return 1;
  const match = lastNumber.match(/-(\d+)$/);
  if (!match) return 1;
  return Number(match[1]) + 1;
}

export async function allocateAccountingNumber(args: {
  tx: Tx;
  tenantId: string;
  tenantSlug: string;
  date: Date;
  kind: AccountingNumberKind;
}): Promise<string> {
  const { tx, tenantId, tenantSlug, date, kind } = args;
  const { prefix, like } = accountingNumberPattern(kind, tenantSlug, date);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`accounting-number:${tenantId}:${kind}`}))`);
  const result = kind === 'transaction'
    ? await tx.execute(sql`
        SELECT transaction_no AS number FROM transactions
         WHERE tenant_id = ${tenantId} AND transaction_no LIKE ${like}
         ORDER BY transaction_no DESC LIMIT 1
      `)
    : await tx.execute(sql`
        SELECT journal_no AS number FROM journals
         WHERE tenant_id = ${tenantId} AND journal_no LIKE ${like}
         ORDER BY journal_no DESC LIMIT 1
      `);
  const last = (result.rows[0] as { number?: string } | undefined)?.number ?? null;
  const next = nextAccountingSequence(last);
  if (next > 9999) {
    throw new Error(`nomor ${kind} untuk periode ini sudah mencapai batas 9999`);
  }
  return `${prefix}${String(next).padStart(4, '0')}`;
}
