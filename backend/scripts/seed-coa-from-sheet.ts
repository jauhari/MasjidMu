/**
 * seed-coa-from-sheet — wipe + reseed Chart of Accounts dari Google Sheets COA tab.
 *
 *   pnpm tsx scripts/seed-coa-from-sheet.ts \
 *     --tenant=admin \
 *     --url=https://docs.google.com/spreadsheets/d/{ID}/edit \
 *     [--sheet=COA] \
 *     [--apply]              # tanpa --apply, dry-run only
 *
 * Yang dilakukan:
 *   1. Fetch xlsx dari Google export endpoint (sheet wajib publik)
 *   2. Parse rows: kolom B (Kode), C (Nama), D (Jenis)
 *   3. Map ke PSAK 45 schema:
 *        - "X-Y00" + jenis kosong → header (parent), code "XY00"
 *        - "X-YZZ" + jenis terisi → detail (child), code "XYZZ", parent = "XY00"
 *        - jenis → accountType + normalBalance via JENIS_MAP
 *   4. Dry-run: print rencana
 *   5. --apply: hapus akun existing tenant (yang BUKAN di-FK dari journals/transactions
 *      yang masih hidup), insert struktur baru
 *
 * Safety: kalau ada journal/transaction yang FK-nya ke akun yang mau dihapus,
 * abort dengan list akun yang tidak bisa dihapus. User harus hapus transaksi dulu.
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import ExcelJS from 'exceljs';
import { eq, isNull, and, sql } from 'drizzle-orm';
import { asSuperAdmin, withTenant, pool } from '../src/db/client.js';
import { tenants } from '../src/db/schema/core.js';
import { accounts, transactionLines, journalLines } from '../src/db/schema/accounting.js';
import type { AccountType, NormalBalance } from '../src/modules/accounting/types.js';

interface Args {
  tenantSlug: string;
  url: string;
  sheet: string;
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string, required = true): string | undefined => {
    const arg = argv.find((a) => a.startsWith(`--${k}=`));
    if (!arg) {
      if (required) throw new Error(`missing --${k}`);
      return undefined;
    }
    return arg.split('=').slice(1).join('=');
  };
  return {
    tenantSlug: get('tenant')!,
    url: get('url')!,
    sheet: get('sheet', false) ?? 'COA',
    apply: argv.includes('--apply'),
  };
}

function extractGoogleSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1]! : null;
}

interface SheetRow {
  rawCode: string;          // e.g. "1-103" or "1-100"
  newCode: string;          // PSAK style: "1103" or "1100"
  parentCode: string | null; // parent's newCode for details (e.g. "1100")
  name: string;
  jenis: string;            // empty = header
  accountType: AccountType;
  normalBalance: NormalBalance;
  isHeader: boolean;
  isSystem: boolean;        // headers are system (cannot delete)
}

const JENIS_MAP: Record<string, { accountType: AccountType; normalBalance: NormalBalance }> = {
  Kas: { accountType: 'asset', normalBalance: 'debit' },
  Bank: { accountType: 'asset', normalBalance: 'debit' },
  Persediaan: { accountType: 'asset', normalBalance: 'debit' },
  Piutang: { accountType: 'asset', normalBalance: 'debit' },
  'Aktiva Lancar Lainnya': { accountType: 'asset', normalBalance: 'debit' },
  'Aktiva Tetap': { accountType: 'asset', normalBalance: 'debit' },
  'Akum. Penyusutan': { accountType: 'contra_asset', normalBalance: 'credit' },
  'Kewajiban Jangka Pendek': { accountType: 'liability', normalBalance: 'credit' },
  'Kewajiban Jangka Panjang': { accountType: 'liability', normalBalance: 'credit' },
  'Aset Neto': { accountType: 'equity', normalBalance: 'credit' },
  Pendapatan: { accountType: 'income', normalBalance: 'credit' },
  Beban: { accountType: 'expense', normalBalance: 'debit' },
};

function mapHeader(rawCode: string): { accountType: AccountType; normalBalance: NormalBalance } {
  // First digit decides
  const d = rawCode[0]!;
  switch (d) {
    case '1':
      return { accountType: 'asset', normalBalance: 'debit' };
    case '2':
      return { accountType: 'liability', normalBalance: 'credit' };
    case '3':
      return { accountType: 'equity', normalBalance: 'credit' };
    case '4':
      return { accountType: 'income', normalBalance: 'credit' };
    case '5':
      return { accountType: 'expense', normalBalance: 'debit' };
    case '6':
      return { accountType: 'expense', normalBalance: 'debit' };
    default:
      throw new Error(`unknown leading digit in code: ${rawCode}`);
  }
}

function rawCodeToNew(rawCode: string): string {
  // "1-103" → "1103"; pad to 4 digits if shorter
  return rawCode.replace('-', '');
}

function deriveParentCode(rawCode: string): string | null {
  // "1-103" → parent "1-100" → "1100"
  const m = rawCode.match(/^([1-9])-(\d)\d{2}$/);
  if (!m) return null;
  if (rawCode.endsWith('00')) return null; // already a header
  return `${m[1]}${m[2]}00`;
}

async function fetchXlsx(url: string): Promise<Buffer> {
  const sheetId = extractGoogleSheetId(url);
  if (!sheetId) throw new Error('invalid Google Sheets URL');
  const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
  const res = await fetch(exportUrl, { redirect: 'follow', headers: { 'User-Agent': 'MasjidMu/1.0' } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('spreadsheet') && !ct.includes('octet-stream') && !ct.includes('zip')) {
    throw new Error('sheet not public — got non-xlsx content-type');
  }
  return Buffer.from(await res.arrayBuffer());
}

function cellText(cell: ExcelJS.Cell): string {
  let v: unknown = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && v !== null && 'result' in (v as Record<string, unknown>)) {
    v = (v as { result: unknown }).result;
  }
  if (v == null) return '';
  return String(v).trim();
}

async function parseCoaSheet(buffer: Buffer, sheetName: string): Promise<SheetRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = wb.getWorksheet(sheetName);
  if (!sheet) throw new Error(`sheet ${sheetName} not found`);

  const rows: SheetRow[] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const rawCode = cellText(row.getCell(2));
    const name = cellText(row.getCell(3));
    const jenis = cellText(row.getCell(4));
    if (!rawCode || !name) continue;
    if (!/^[1-9]-\d{3}$/.test(rawCode)) continue;

    const isHeader = !jenis || rawCode.endsWith('00');
    const newCode = rawCodeToNew(rawCode);
    const parentCode = isHeader ? null : deriveParentCode(rawCode);

    let accountType: AccountType;
    let normalBalance: NormalBalance;
    if (isHeader) {
      ({ accountType, normalBalance } = mapHeader(rawCode));
    } else {
      const m = JENIS_MAP[jenis];
      if (!m) throw new Error(`unknown jenis "${jenis}" at row ${r} (${rawCode} ${name})`);
      ({ accountType, normalBalance } = m);
    }

    rows.push({
      rawCode,
      newCode,
      parentCode,
      name,
      jenis,
      accountType,
      normalBalance,
      isHeader,
      isSystem: isHeader,
    });
  }
  return rows;
}

async function main() {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error('Usage: pnpm tsx scripts/seed-coa-from-sheet.ts --tenant=<slug> --url=<google_sheets_url> [--sheet=COA] [--apply]');
    console.error('Error:', (e as Error).message);
    process.exit(1);
  }

  console.log(`1. Fetch ${args.url}…`);
  const xlsx = await fetchXlsx(args.url);
  console.log(`   ✓ ${xlsx.length} bytes`);

  console.log(`2. Parse sheet "${args.sheet}"…`);
  const rows = await parseCoaSheet(xlsx, args.sheet);
  const headers = rows.filter((r) => r.isHeader);
  const details = rows.filter((r) => !r.isHeader);
  console.log(`   ✓ ${rows.length} rows (${headers.length} headers + ${details.length} details)`);

  // Verify every detail's parent exists in headers
  const headerCodes = new Set(headers.map((h) => h.newCode));
  const orphans = details.filter((d) => d.parentCode && !headerCodes.has(d.parentCode));
  if (orphans.length > 0) {
    console.error('   ✗ orphaned details (parent header not found):');
    for (const o of orphans) console.error(`      ${o.rawCode} ${o.name} → parent ${o.parentCode}`);
    process.exit(1);
  }
  console.log(`   ✓ all ${details.length} details have valid parents`);

  // Resolve tenant
  const tenant = await asSuperAdmin(async (tx) => {
    const r = await tx.select().from(tenants).where(eq(tenants.slug, args.tenantSlug));
    return r[0] ?? null;
  });
  if (!tenant) {
    console.error(`   ✗ tenant "${args.tenantSlug}" not found`);
    process.exit(1);
  }
  console.log(`3. Target tenant: ${tenant.id} (${tenant.slug})`);

  console.log('4. Check existing accounts in tenant…');
  const existing = await withTenant(tenant.id, async (db) => {
    return db
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenant.id), isNull(accounts.deletedAt)));
  });
  console.log(`   • existing active accounts: ${existing.length}`);

  // Check FK references — accounts referenced by transaction_lines or journal_lines cannot be hard-deleted
  const inUse = await asSuperAdmin(async (db) => {
    const r = await db.execute(sql`
      SELECT a.id, a.code, a.name,
             COALESCE((SELECT COUNT(*) FROM transaction_lines tl WHERE tl.account_id = a.id), 0)::int AS tl_count,
             COALESCE((SELECT COUNT(*) FROM journal_lines jl WHERE jl.account_id = a.id), 0)::int AS jl_count
        FROM accounts a
       WHERE a.tenant_id = ${tenant.id}
         AND a.deleted_at IS NULL
    `);
    return (r.rows as Array<{ id: string; code: string; name: string; tl_count: number; jl_count: number }>).filter(
      (x) => x.tl_count > 0 || x.jl_count > 0,
    );
  });
  if (inUse.length > 0) {
    console.error(`   ✗ ${inUse.length} accounts are referenced by transaction_lines / journal_lines:`);
    for (const u of inUse.slice(0, 20)) console.error(`      ${u.code} ${u.name} (tl=${u.tl_count}, jl=${u.jl_count})`);
    if (inUse.length > 20) console.error(`      … and ${inUse.length - 20} more`);
    console.error('\n   Hapus transaksi dulu sebelum reseed COA, atau pakai mapping manual di UI import.');
    process.exit(1);
  }
  console.log('   ✓ no accounts in use — safe to wipe');

  if (!args.apply) {
    console.log('\n=== DRY RUN PREVIEW (first 20 + last 5) ===');
    for (const h of headers) {
      console.log(`  HDR ${h.newCode} ${h.name} [${h.accountType}/${h.normalBalance}]`);
    }
    console.log('\nDetails preview (first 20):');
    for (const d of details.slice(0, 20)) {
      console.log(`  DET ${d.newCode} ${d.name} [${d.accountType}/${d.normalBalance}] parent=${d.parentCode}`);
    }
    console.log(`\n  ... (${details.length - 20} more details)`);
    console.log('\nUse --apply to execute.');
    await pool.end();
    return;
  }

  console.log('\n5. APPLY: deleting existing transaction_categories + accounts…');
  await asSuperAdmin(async (db) => {
    const c = await db.execute(sql`DELETE FROM transaction_categories WHERE tenant_id = ${tenant.id}`);
    console.log(`   ✓ deleted ${c.rowCount ?? 0} categories`);
    const r = await db.execute(sql`DELETE FROM accounts WHERE tenant_id = ${tenant.id}`);
    console.log(`   ✓ deleted ${r.rowCount ?? 0} accounts`);
  });

  console.log('6. Inserting headers…');
  const headerIds = new Map<string, string>();
  await withTenant(tenant.id, async (db) => {
    for (const h of headers) {
      const [r] = await db
        .insert(accounts)
        .values({
          tenantId: tenant.id,
          parentId: null,
          code: h.newCode,
          name: h.name,
          accountType: h.accountType,
          normalBalance: h.normalBalance,
          isSystem: true,
          isActive: true,
        })
        .returning({ id: accounts.id, code: accounts.code });
      headerIds.set(r!.code, r!.id);
    }
  });
  console.log(`   ✓ ${headerIds.size} headers inserted`);

  console.log('7. Inserting details…');
  let detailCount = 0;
  await withTenant(tenant.id, async (db) => {
    for (const d of details) {
      const parentId = d.parentCode ? headerIds.get(d.parentCode) ?? null : null;
      await db.insert(accounts).values({
        tenantId: tenant.id,
        parentId,
        code: d.newCode,
        name: d.name,
        accountType: d.accountType,
        normalBalance: d.normalBalance,
        isSystem: false,
        isActive: true,
      });
      detailCount++;
    }
  });
  console.log(`   ✓ ${detailCount} details inserted`);

  console.log(`\n✅ Done. Total accounts in tenant ${tenant.slug}: ${headerIds.size + detailCount}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ Failed:', e);
  await pool.end();
  process.exit(1);
});

void transactionLines;
void journalLines;
