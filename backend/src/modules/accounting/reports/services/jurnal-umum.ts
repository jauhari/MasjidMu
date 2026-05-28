/**
 * Jurnal Umum — flat chronological journal listing for the period.
 *
 * Each row is one journal_line, tied back to its journal header. Sorted by
 * (journal_date, journal_no, sort_order) so the UI can present a printable
 * day-book.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import type { JurnalUmumData, ReportPeriod } from '../types.js';

interface Row {
  journal_no: string;
  journal_date: string;
  description: string | null;
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
}

export async function buildJurnalUmum(args: {
  tenantId: string;
  period: ReportPeriod;
}): Promise<JurnalUmumData> {
  const { tenantId, period } = args;
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT journal_no,
             journal_date::text AS journal_date,
             COALESCE(line_description, journal_description) AS description,
             account_code,
             account_name,
             debit::text  AS debit,
             credit::text AS credit
        FROM v_general_ledger
       WHERE tenant_id = ${tenantId}
         AND journal_date BETWEEN ${period.startDate.toISOString()}::timestamptz
                              AND ${period.endDate.toISOString()}::timestamptz
       ORDER BY journal_date, journal_no, sort_order
    `);

    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    const lines = (r.rows as unknown as Row[]).map((row) => {
      totalDebit = totalDebit.plus(row.debit);
      totalCredit = totalCredit.plus(row.credit);
      return {
        journalNo: row.journal_no,
        journalDate: row.journal_date,
        description: row.description,
        accountCode: row.account_code,
        accountName: row.account_name,
        debit: new Decimal(row.debit).toFixed(2),
        credit: new Decimal(row.credit).toFixed(2),
      };
    });

    return {
      lines,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
    };
  });
}
