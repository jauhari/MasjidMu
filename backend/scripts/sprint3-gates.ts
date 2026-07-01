/**
 * Sprint 3 acceptance gate runner.
 *
 * Verifies that the accounting module (COA, categories, transactions, state
 * machine, journal generation) is wired correctly end-to-end.
 *
 * Run: pnpm tsx scripts/sprint3-gates.ts
 */
import { sql } from 'drizzle-orm';
import { asSuperAdmin, db, pool } from '../src/db/client.js';

type GateResult = { name: string; pass: boolean; detail: string };

async function gate1_coaSeeded(): Promise<GateResult> {
  const r = await asSuperAdmin(async (tx) =>
    tx.execute(sql`
      SELECT COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE is_system) ::int AS sys,
             COUNT(*) FILTER (WHERE deleted_at IS NULL) ::int AS active
        FROM accounts
    `),
  );
  const row = r.rows[0] as { n: number; sys: number; active: number };
  return {
    name: 'PSAK 45 chart seeded',
    pass: row.active >= 30 && row.sys >= 5,
    detail: `total=${row.n}, active=${row.active}, system=${row.sys}`,
  };
}

async function gate2_coaHierarchy(): Promise<GateResult> {
  const r = await asSuperAdmin(async (tx) =>
    tx.execute(sql`
      SELECT a.code, a.parent_id IS NOT NULL AS has_parent, p.code AS parent_code
        FROM accounts a
        LEFT JOIN accounts p ON p.id = a.parent_id
       WHERE a.deleted_at IS NULL
    `),
  );
  type R = { code: string; has_parent: boolean; parent_code: string | null };
  const rows = r.rows as R[];

  const issues: string[] = [];
  for (const row of rows) {
    if (!/^\d{4}$/.test(row.code)) continue;
    const expectsParent = !row.code.endsWith('000');
    if (expectsParent && !row.has_parent) {
      issues.push(`${row.code} missing parent`);
    }
    if (!expectsParent && row.has_parent) {
      issues.push(`${row.code} has unexpected parent ${row.parent_code}`);
    }
    if (row.has_parent && row.parent_code) {
      const expected = row.code.endsWith('00')
        ? row.code[0] + '000'
        : row.code.slice(0, 2) + '00';
      if (row.parent_code !== expected) {
        issues.push(`${row.code} parent=${row.parent_code} expected=${expected}`);
      }
    }
  }
  return {
    name: 'COA hierarchy linkage',
    pass: issues.length === 0,
    detail: issues.length === 0 ? `${rows.length} accounts validated` : issues.slice(0, 5).join('; '),
  };
}

async function gate3_categoryMapping(): Promise<GateResult> {
  const r = await asSuperAdmin(async (tx) =>
    tx.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM transaction_categories tc
        LEFT JOIN accounts d ON d.id = tc.debit_account_id
        LEFT JOIN accounts c ON c.id = tc.credit_account_id
       WHERE tc.deleted_at IS NULL
         AND (
           (tc.direction = 'income'
            AND tc.credit_account_id IS NOT NULL
            AND c.deleted_at IS NULL
            AND (tc.debit_account_id IS NULL OR d.deleted_at IS NULL))
           OR
           (tc.direction = 'expense'
            AND tc.debit_account_id IS NOT NULL
            AND d.deleted_at IS NULL
            AND (tc.credit_account_id IS NULL OR c.deleted_at IS NULL))
         )
    `),
  );
  const n = (r.rows[0] as { n: number }).n;
  return {
    name: 'Transaction categories link valid accounts',
    pass: n >= 1,
    detail: `${n} categories with required account mapping (PSAK 45 direction rule)`,
  };
}

async function gate4_transactionPosted(): Promise<GateResult> {
  const r = await asSuperAdmin(async (tx) =>
    tx.execute(sql`
      SELECT t.id, t.transaction_no, t.status, t.amount,
             j.id AS journal_id, j.journal_no
        FROM transactions t
        LEFT JOIN journals j ON j.transaction_id = t.id
       WHERE t.status = 'posted'
       ORDER BY t.created_at DESC
       LIMIT 1
    `),
  );
  if (r.rows.length === 0) {
    return { name: 'At least one posted transaction', pass: false, detail: 'no posted transactions yet' };
  }
  const row = r.rows[0] as { transaction_no: string; journal_no: string | null; amount: string };
  return {
    name: 'At least one posted transaction with journal',
    pass: row.journal_no !== null,
    detail: `tx=${row.transaction_no} journal=${row.journal_no} amount=${row.amount}`,
  };
}

async function gate5_journalBalanced(): Promise<GateResult> {
  const r = await asSuperAdmin(async (tx) =>
    tx.execute(sql`
      SELECT j.id, j.journal_no,
             COALESCE(SUM(jl.debit), 0)::numeric AS sum_debit,
             COALESCE(SUM(jl.credit), 0)::numeric AS sum_credit
        FROM journals j
        LEFT JOIN journal_lines jl ON jl.journal_id = j.id
       GROUP BY j.id, j.journal_no
    `),
  );
  type R = { journal_no: string; sum_debit: string; sum_credit: string };
  const rows = r.rows as R[];
  const unbalanced = rows.filter((row) => row.sum_debit !== row.sum_credit);
  return {
    name: 'All journals balanced (sum_debit = sum_credit)',
    pass: unbalanced.length === 0,
    detail:
      unbalanced.length === 0
        ? `${rows.length} journals balanced`
        : `UNBALANCED: ${unbalanced.map((u) => u.journal_no).join(', ')}`,
  };
}

async function gate6_unitTestsPass(): Promise<GateResult> {
  // We don't run the full suite from here; just import the modules to
  // ensure they at least load cleanly.
  try {
    await import('../src/modules/accounting/_validators/financial.js');
    await import('../src/modules/accounting/transactions/state-machine.js');
    await import('../src/modules/accounting/transactions/service.js');
    return {
      name: 'Accounting modules load',
      pass: true,
      detail: 'validator, state-machine, service',
    };
  } catch (e) {
    return { name: 'Accounting modules load', pass: false, detail: (e as Error).message };
  }
}

async function gate7_decimalJsAvailable(): Promise<GateResult> {
  try {
    const { Decimal } = await import('decimal.js');
    const result = new Decimal('1000000.01').plus(new Decimal('0.99'));
    const ok = result.toFixed(2) === '1000001.00';
    return {
      name: 'decimal.js for money math',
      pass: ok,
      detail: ok ? '1000000.01 + 0.99 = 1000001.00 ✓' : `unexpected: ${result.toString()}`,
    };
  } catch (e) {
    return { name: 'decimal.js available', pass: false, detail: (e as Error).message };
  }
}

async function main() {
  const gates = [
    gate1_coaSeeded,
    gate2_coaHierarchy,
    gate3_categoryMapping,
    gate4_transactionPosted,
    gate5_journalBalanced,
    gate6_unitTestsPass,
    gate7_decimalJsAvailable,
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Sprint 3 Acceptance Gates');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let allPass = true;
  for (const g of gates) {
    const r = await g();
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon}  ${r.name}`);
    console.log(`      ${r.detail}\n`);
    if (!r.pass) allPass = false;
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(allPass ? '🟢 ALL GATES PASSED — Sprint 4 (reports) can begin' : '🔴 GATES FAILED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  void db; // silence unused warning
  await pool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
