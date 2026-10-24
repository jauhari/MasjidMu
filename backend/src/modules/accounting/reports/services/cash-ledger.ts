/**
 * Buku Kas -- the cash book a bendahara keeps by hand: one row per cash
 * movement (date, keterangan, masuk, keluar) with a running saldo.
 *
 * Built from journal lines on cash accounts (asset, code 11xx -- the same
 * definition buildCashFlow uses), read LIVE from journals rather than the
 * mv_account_balances materialized view, so the saldo can never be stale
 * and always agrees with the row-by-row arithmetic printed next to it.
 * Every cash movement is listed, including ones against a non income/expense
 * account (e.g. the opening "Dana dari Bendahara Lama"), because a saldo
 * that skipped those would not reconcile with the real balance. Transfers
 * between two cash accounts net to zero and are dropped.
 *
 * Privacy: the keterangan is either the category name (default) or the
 * transaction's own description run through maskPublicDescription -- see
 * showDescriptions. Voucher numbers and account codes are never exposed.
 */
import { sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { withTenant } from '../../../../db/client.js';
import { maskPublicDescription } from '../../../../lib/mask-personal-names.js';
import type { ReportPeriod } from '../types.js';

export interface CashLedgerEntry {
  /** YYYY-MM-DD */
  date: string;
  keterangan: string;
  masuk: string;
  keluar: string;
  saldo: string;
}

export interface CashLedger {
  openingBalance: string;
  closingBalance: string;
  totalMasuk: string;
  totalKeluar: string;
  entries: CashLedgerEntry[];
  /** True when the period holds more rows than MAX_LEDGER_ENTRIES (entries is the first MAX). */
  truncated: boolean;
  /** Whether keterangan carries (masked) transaction descriptions rather than category names. */
  descriptionsVisible: boolean;
}

const MAX_LEDGER_ENTRIES = 1000;

export interface EntryRow {
  d: string;
  description: string | null;
  category_name: string | null;
  net: string;
}

export async function buildCashLedger(args: {
  tenantId: string;
  period: ReportPeriod;
  showDescriptions: boolean;
  maskNames?: boolean;
}): Promise<CashLedger> {
  const { tenantId, period, showDescriptions, maskNames = false } = args;
  const start = period.startDate.toISOString();
  const end = period.endDate.toISOString();

  const { opening, totals, rows } = await withTenant(tenantId, async (tx) => {
    const cashAccts = sql`
      SELECT id FROM accounts
       WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND account_type = 'asset' AND code LIKE '11%'
    `;

    const openingRes = await tx.execute(sql`
      SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS net
        FROM journals j
        JOIN journal_lines jl ON jl.journal_id = j.id
       WHERE j.tenant_id = ${tenantId}
         AND jl.account_id IN (${cashAccts})
         AND j.journal_date < ${start}::timestamptz
    `);

    const totalsRes = await tx.execute(sql`
      WITH per_journal AS (
        SELECT SUM(jl.debit - jl.credit) AS net
          FROM journals j
          JOIN journal_lines jl ON jl.journal_id = j.id
         WHERE j.tenant_id = ${tenantId}
           AND jl.account_id IN (${cashAccts})
           AND j.journal_date >= ${start}::timestamptz
           AND j.journal_date <= ${end}::timestamptz
         GROUP BY j.id
      )
      SELECT COALESCE(SUM(GREATEST(net, 0)), 0)::text  AS total_masuk,
             COALESCE(SUM(GREATEST(-net, 0)), 0)::text AS total_keluar,
             COUNT(*) FILTER (WHERE net <> 0)::int     AS n
        FROM per_journal
    `);

    const rowsRes = await tx.execute(sql`
      SELECT (j.journal_date AT TIME ZONE 'UTC')::date::text AS d,
             COALESCE(NULLIF(btrim(t.description), ''), NULLIF(btrim(j.description), '')) AS description,
             tc.name AS category_name,
             SUM(jl.debit - jl.credit)::text AS net
        FROM journals j
        JOIN journal_lines jl ON jl.journal_id = j.id AND jl.account_id IN (${cashAccts})
        LEFT JOIN transactions t ON t.id = j.transaction_id
        LEFT JOIN transaction_categories tc ON tc.id = t.category_id
       WHERE j.tenant_id = ${tenantId}
         AND j.journal_date >= ${start}::timestamptz
         AND j.journal_date <= ${end}::timestamptz
       GROUP BY j.id, j.journal_date, j.created_at, j.journal_no, t.description, j.description, tc.name
      HAVING SUM(jl.debit - jl.credit) <> 0
       ORDER BY j.journal_date, j.created_at, j.journal_no
       LIMIT ${MAX_LEDGER_ENTRIES + 1}
    `);

    return {
      opening: new Decimal((openingRes.rows[0] as { net: string }).net),
      totals: totalsRes.rows[0] as { total_masuk: string; total_keluar: string; n: number },
      rows: rowsRes.rows as unknown as EntryRow[],
    };
  });

  return assembleCashLedger({
    opening: opening.toString(),
    totalMasuk: totals.total_masuk,
    totalKeluar: totals.total_keluar,
    rows,
    showDescriptions,
    maskNames,
  });
}

/**
 * Pure part of the ledger: running saldo, keterangan choice and the
 * truncation rule. Separate from the queries so it can be unit-tested with
 * real cash-book rows without a database.
 */
export function assembleCashLedger(input: {
  opening: string;
  totalMasuk: string;
  totalKeluar: string;
  /** Rows in chronological order; may contain one more than MAX_LEDGER_ENTRIES to signal truncation. */
  rows: EntryRow[];
  showDescriptions: boolean;
  maskNames?: boolean;
}): CashLedger {
  const { rows, showDescriptions, maskNames = false } = input;
  const opening = new Decimal(input.opening);
  const truncated = rows.length > MAX_LEDGER_ENTRIES;
  const visible = truncated ? rows.slice(0, MAX_LEDGER_ENTRIES) : rows;

  let running = opening;
  const entries: CashLedgerEntry[] = visible.map((r) => {
    const net = new Decimal(r.net);
    running = running.plus(net);
    const rawDesc = r.description?.trim() || null;
    const desc = showDescriptions
      ? (maskNames ? maskPublicDescription(rawDesc) : rawDesc)
      : null;
    const keterangan =
      desc ?? r.category_name ?? (net.isPositive() ? 'Penerimaan' : 'Pengeluaran');
    return {
      date: r.d,
      keterangan,
      masuk: net.isPositive() ? net.toFixed(2) : '0.00',
      keluar: net.isNegative() ? net.abs().toFixed(2) : '0.00',
      saldo: running.toFixed(2),
    };
  });

  const totalMasuk = new Decimal(input.totalMasuk);
  const totalKeluar = new Decimal(input.totalKeluar);
  return {
    openingBalance: opening.toFixed(2),
    // Derived from the aggregate, not from the (possibly truncated) rows.
    closingBalance: opening.plus(totalMasuk).minus(totalKeluar).toFixed(2),
    totalMasuk: totalMasuk.toFixed(2),
    totalKeluar: totalKeluar.toFixed(2),
    entries,
    truncated,
    descriptionsVisible: showDescriptions,
  };
}
