/**
 * One-off historical import: PCA Ponjong buku kas (Google Sheet) → transactions.
 *
 * Source: https://docs.google.com/spreadsheets/d/16V89jk23vX42VzVTLa7t2lzU2kkopcb0bnI2GvWjKy0
 * 75 baris transisi ditranskripsi manual dari sheet (kolom No/TGL/Keterangan/Masuk/Keluar).
 * Baris 76-114 di sheet adalah baris kosong/carry-forward, sengaja tidak diikutkan.
 *
 * Validasi sebelum coding: total Masuk (21.846.000) & Keluar (17.534.000) dan saldo
 * berjalan tiap baris dihitung ulang independen dari data ini — cocok 100% dengan
 * kolom "Saldo" otoritatif (kolom terakhir) di sheet untuk seluruh 75 baris.
 *
 * Setiap baris diposting sebagai transaksi 2-baris (Kas vs kategori) memakai jalur
 * yang sama dengan commitPAPImport (posted langsung + jurnal + approval log dalam
 * satu DB transaction, per-tenant RLS via withTenant). Idempotent: referenceNo unik
 * per baris ("PCA-KAS-{no}"), baris yang referenceNo-nya sudah ada di-skip.
 *
 *   pnpm tsx scripts/import-pca-ponjong-kas.ts            # dry-run (default)
 *   pnpm tsx scripts/import-pca-ponjong-kas.ts --apply     # tulis ke DB
 */
import { and, eq, isNull } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { asSuperAdmin, withTenant, pool } from '../src/db/client.js';
import { tenants } from '../src/db/schema/core.js';
import {
  accounts,
  approvalLogs,
  journalLines,
  journals,
  transactionCategories,
  transactionLines,
  transactions,
} from '../src/db/schema/accounting.js';
import { allocateAccountingNumber } from '../src/modules/accounting/transactions/numbering.js';

const TENANT_SLUG = 'pca-ponjong';
const ACTOR_USER_ID = 'f65feac5-b6e8-4adc-bb87-f241e97d48d0'; // barookahjaya@gmail.com (Super Admin di tenant ini)

type Row = {
  no: number;
  /** dd/mm/yyyy, persis seperti ditulis di sheet — tidak "diperbaiki". */
  date: string;
  description: string;
  masuk: number;
  keluar: number;
  /** Saldo berjalan otoritatif dari sheet (kolom terakhir), untuk cross-check. */
  expectedBalance: number;
};

// Transkripsi lengkap 75 baris (No 1-75). Header/footer/baris kosong (76-114) dikecualikan.
const ROWS: Row[] = [
  { no: 1, date: '26/08/2023', description: 'Dana dari Bendahara Lama', masuk: 1590000, keluar: 0, expectedBalance: 1590000 },
  { no: 2, date: '09/02/2023', description: 'Pesan Banner', masuk: 0, keluar: 80000, expectedBalance: 1510000 },
  { no: 3, date: '23/09/2023', description: 'Infaq Anggota', masuk: 881900, keluar: 0, expectedBalance: 2391900 },
  { no: 4, date: '23/09/2023', description: 'Infaq dari B. Umi Fadhilah', masuk: 150000, keluar: 0, expectedBalance: 2541900 },
  { no: 5, date: '23/09/2023', description: 'Infaq dari B. Yanti', masuk: 100000, keluar: 0, expectedBalance: 2641900 },
  { no: 6, date: '23/09/2023', description: 'Bayar konsumsi Raker', masuk: 0, keluar: 500000, expectedBalance: 2141900 },
  { no: 7, date: '23/09/2023', description: 'Tambahan konsumsi acara Pengukuhan', masuk: 0, keluar: 636000, expectedBalance: 1505900 },
  { no: 8, date: '30/09/2023', description: 'Kontribusi Pengajian Akbar', masuk: 0, keluar: 50000, expectedBalance: 1455900 },
  { no: 9, date: '30/09/2023', description: 'Transport B. Sumarmi', masuk: 0, keluar: 50000, expectedBalance: 1405900 },
  { no: 10, date: '10/08/2023', description: 'Transport ke UMY 3 utusan', masuk: 0, keluar: 90000, expectedBalance: 1315900 },
  { no: 11, date: '28/10/2023', description: 'Konsumsi konsolidasi di SMK.Muh.krgmj', masuk: 0, keluar: 250000, expectedBalance: 1065900 },
  { no: 12, date: '11/04/2023', description: 'Infaq Anggota (kaleng)', masuk: 977800, keluar: 0, expectedBalance: 2043700 },
  { no: 13, date: '12/03/2023', description: 'Acara SWA 2 utusan', masuk: 0, keluar: 520000, expectedBalance: 1523700 },
  { no: 14, date: '12/03/2023', description: 'Konsumsi Pawai', masuk: 0, keluar: 500000, expectedBalance: 1023700 },
  { no: 15, date: '12/03/2023', description: 'Infaq Anggota (kaleng)', masuk: 1097500, keluar: 0, expectedBalance: 2121200 },
  { no: 16, date: '12/06/2023', description: 'Acara MHH', masuk: 0, keluar: 1010000, expectedBalance: 1111200 },
  { no: 17, date: '09/12/2023', description: 'Pengembalian konsumsi', masuk: 638000, keluar: 0, expectedBalance: 1749200 },
  { no: 18, date: '12/09/2023', description: 'Subsidi Rapat program kerja', masuk: 1000000, keluar: 0, expectedBalance: 2749200 },
  { no: 19, date: '31/12/2023', description: 'Infaq Anggota (kaleng)', masuk: 860500, keluar: 0, expectedBalance: 3609700 },
  { no: 20, date: '01/10/2024', description: 'Konsumsi Lintas Cabang', masuk: 0, keluar: 1500000, expectedBalance: 2109700 },
  { no: 21, date: '14/01/2024', description: 'Infaq Lintas Cabang', masuk: 300000, keluar: 0, expectedBalance: 2409700 },
  { no: 22, date: '28/01/2024', description: 'Transport + Makan (Hari berAisyiyah)', masuk: 0, keluar: 673000, expectedBalance: 1736700 },
  { no: 23, date: '02/08/2024', description: 'Kontribusi pengajian di Playen', masuk: 0, keluar: 50000, expectedBalance: 1686700 },
  { no: 24, date: '17/03/2024', description: 'Infaq anggota (Kaleng)', masuk: 1215000, keluar: 0, expectedBalance: 2901700 },
  { no: 25, date: '05/09/2024', description: 'Diklat dakwah digital 3 Utusan @ 75.000', masuk: 0, keluar: 225000, expectedBalance: 2676700 },
  { no: 26, date: '18/05/2024', description: 'Infaq Anggota (kaleng)', masuk: 938800, keluar: 0, expectedBalance: 3615500 },
  { no: 27, date: '23/05/2024', description: 'Transport + Makan Acara Resepi Milad Aisyiyah', masuk: 0, keluar: 860000, expectedBalance: 2755500 },
  { no: 28, date: '23/05/2024', description: 'Infaq B. Umi Syarifah', masuk: 50000, keluar: 0, expectedBalance: 2805500 },
  { no: 29, date: '23/05/2024', description: 'Infaq B. Latiyem', masuk: 100000, keluar: 0, expectedBalance: 2905500 },
  { no: 30, date: '24/05/2024', description: 'Acara MHH di UMY 2 utusan @ Rp. 50.000', masuk: 0, keluar: 100000, expectedBalance: 2805500 },
  { no: 31, date: '18/07/2024', description: 'Beli Buah Untuk P. Ratno & B. Suwarni @ Rp. 100.000', masuk: 0, keluar: 200000, expectedBalance: 2605500 },
  { no: 32, date: '02/08/2024', description: 'Infaq Anggota (kaleng)', masuk: 898700, keluar: 0, expectedBalance: 3504200 },
  { no: 33, date: '25/08/2024', description: 'Snack & oleh2 Acara Screening Kesehatan', masuk: 0, keluar: 677000, expectedBalance: 2827200 },
  { no: 34, date: '13/04/2024', description: 'Infaq Anggota (kaleng)', masuk: 1070500, keluar: 0, expectedBalance: 3897700 },
  { no: 35, date: '30/09/2024', description: 'Baksos Majelis Tabligh 5 Paket @ Rp. 50.000', masuk: 0, keluar: 250000, expectedBalance: 3647700 },
  { no: 36, date: '11/10/2024', description: 'Infaq Anggota (kaleng)', masuk: 629500, keluar: 0, expectedBalance: 4277200 },
  { no: 37, date: '11/10/2024', description: 'Kegiatan LBSO + transport', masuk: 0, keluar: 150000, expectedBalance: 4127200 },
  { no: 38, date: '19/11/2024', description: 'Infaq Lintas cabang Majelis Kesehatan', masuk: 700000, keluar: 0, expectedBalance: 4827200 },
  { no: 39, date: '19/11/2024', description: 'Konsumsi Lintas cabang', masuk: 0, keluar: 2300000, expectedBalance: 2527200 },
  { no: 40, date: '19/11/2024', description: 'Infaq B. Ngatir', masuk: 30000, keluar: 0, expectedBalance: 2557200 },
  { no: 41, date: '24/11/2024', description: 'Kegiatan Bincang disemin', masuk: 0, keluar: 830000, expectedBalance: 1727200 },
  { no: 42, date: '24/11/2024', description: 'Infaq B. Sari', masuk: 200000, keluar: 0, expectedBalance: 1927200 },
  { no: 43, date: '24/11/2024', description: 'Infaq P. Sutrisno', masuk: 2000000, keluar: 0, expectedBalance: 3927200 },
  { no: 44, date: '24/11/2024', description: 'Transport ke Semin', masuk: 0, keluar: 300000, expectedBalance: 3627200 },
  { no: 45, date: '29/11/2024', description: 'Infaq Anggota (kaleng)', masuk: 336000, keluar: 0, expectedBalance: 3963200 },
  { no: 46, date: '20/12/2024', description: 'Infaq Anggota (kaleng)', masuk: 1297800, keluar: 0, expectedBalance: 5261000 },
  { no: 47, date: '29/01/2025', description: 'Biaya Pembuatan Vidio Lomba kegiatan GLHA', masuk: 0, keluar: 500000, expectedBalance: 4761000 },
  { no: 48, date: '29/01/2025', description: 'Infaq Anggota (kaleng)', masuk: 643000, keluar: 0, expectedBalance: 5404000 },
  { no: 49, date: '02/02/2025', description: 'Biaya Pertemuan lintas Ranting', masuk: 0, keluar: 500000, expectedBalance: 4904000 },
  { no: 50, date: '02/02/2025', description: 'Keg. Maj. Pembinaan Kader', masuk: 0, keluar: 590000, expectedBalance: 4314000 },
  { no: 51, date: '16/02/2025', description: 'Keg. LBSO 2 utusan', masuk: 0, keluar: 150000, expectedBalance: 4164000 },
  { no: 52, date: '27/02/2025', description: 'Pengajian Akbar Maj. Tabligh', masuk: 0, keluar: 50000, expectedBalance: 4114000 },
  { no: 53, date: '08/03/2025', description: 'Infaq Kunsiroh', masuk: 870500, keluar: 0, expectedBalance: 4984500 },
  { no: 54, date: '08/03/2025', description: 'Untuk Ranting Genjahan', masuk: 0, keluar: 250000, expectedBalance: 4734500 },
  { no: 55, date: '08/03/2025', description: 'Banner', masuk: 0, keluar: 120000, expectedBalance: 4614500 },
  { no: 56, date: '08/03/2025', description: 'Infaq B. Dalimah & B. ngatir', masuk: 77000, keluar: 0, expectedBalance: 4691500 },
  { no: 57, date: '08/03/2025', description: 'Oleh2 untuk PDA', masuk: 0, keluar: 320000, expectedBalance: 4371500 },
  { no: 58, date: '28/04/2025', description: 'Sisa uang konsumsi Syawalan', masuk: 150000, keluar: 0, expectedBalance: 4521500 },
  { no: 59, date: '02/05/2025', description: 'Biaya Muspimwil', masuk: 0, keluar: 450000, expectedBalance: 4071500 },
  { no: 60, date: '27/05/2025', description: 'Bagi hasil kaos Rihlah', masuk: 280000, keluar: 0, expectedBalance: 4351500 },
  { no: 61, date: '10/06/2025', description: 'Biaya peserta SWA 2 utusan @ Rp 300.000', masuk: 0, keluar: 600000, expectedBalance: 3751500 },
  { no: 62, date: '12/07/2025', description: 'Kontribusi Majelis Tabligh & Ketarjihan', masuk: 0, keluar: 50000, expectedBalance: 3701500 },
  { no: 63, date: '12/07/2025', description: 'Buku Panduan BIKKSA', masuk: 0, keluar: 75000, expectedBalance: 3626500 },
  { no: 64, date: '18/07/2025', description: 'Kegiatan LSBO', masuk: 0, keluar: 300000, expectedBalance: 3326500 },
  { no: 65, date: '18/07/2025', description: 'Infaq Kencleng', masuk: 826000, keluar: 0, expectedBalance: 4152500 },
  { no: 66, date: '30/07/2025', description: 'Door Prize Pengajian Akbar', masuk: 0, keluar: 168000, expectedBalance: 3984500 },
  { no: 67, date: '05/08/2025', description: 'MUSPIMDA', masuk: 0, keluar: 200000, expectedBalance: 3784500 },
  { no: 68, date: '13/08/2025', description: 'SWO Majelis Tabligh', masuk: 0, keluar: 100000, expectedBalance: 3684500 },
  { no: 69, date: '22/08/2025', description: 'Transport 2 Utusan', masuk: 0, keluar: 200000, expectedBalance: 3484500 },
  { no: 70, date: '22/08/2025', description: 'Infaq', masuk: 1149000, keluar: 0, expectedBalance: 4633500 },
  { no: 71, date: '23/08/2025', description: 'Lintas Ranting', masuk: 0, keluar: 500000, expectedBalance: 4133500 },
  { no: 72, date: '12/09/2025', description: 'Transport JEC', masuk: 0, keluar: 50000, expectedBalance: 4083500 },
  { no: 73, date: '26/09/2025', description: 'Infaq', masuk: 788500, keluar: 0, expectedBalance: 4872000 },
  { no: 74, date: '26/09/2025', description: 'Papan Nama', masuk: 0, keluar: 300000, expectedBalance: 4572000 },
  { no: 75, date: '10/12/2025', description: 'Topo Gerak Jalan', masuk: 0, keluar: 260000, expectedBalance: 4312000 },
];

/** Baris "penerimaan lain-lain" (bukan infaq) — subsidi/pengembalian/bagi hasil. */
const OTHER_INCOME_ROWS = new Set([17, 18, 58, 60]);

function parseDdMmYyyy(s: string): Date {
  const [d, m, y] = s.split('/').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 0, 0, 0));
}

async function main() {
  const apply = process.argv.includes('--apply');

  console.log('0. Cross-check saldo berjalan (independen dari transkripsi)...');
  let running = 0;
  for (const r of ROWS) {
    running += r.masuk - r.keluar;
    if (running !== r.expectedBalance) {
      console.error(`   ✗ MISMATCH baris ${r.no} (${r.description}): computed=${running} expected=${r.expectedBalance}`);
      process.exit(1);
    }
  }
  console.log(`   ✓ ${ROWS.length} baris, saldo akhir Rp${running.toLocaleString('id-ID')} — cocok dengan sheet di setiap baris`);

  console.log(`\n1. Resolve tenant "${TENANT_SLUG}"...`);
  const tenant = await asSuperAdmin(async (tx) => {
    const r = await tx.select().from(tenants).where(eq(tenants.slug, TENANT_SLUG));
    return r[0] ?? null;
  });
  if (!tenant) {
    console.error(`   ✗ tenant "${TENANT_SLUG}" tidak ditemukan`);
    process.exit(1);
  }
  console.log(`   ✓ ${tenant.id} (${tenant.name}, edisi ${tenant.edition})`);

  console.log('\n2. Resolve akun COA...');
  const acctRows = await withTenant(tenant.id, (db) =>
    db.select().from(accounts).where(and(eq(accounts.tenantId, tenant.id), isNull(accounts.deletedAt))),
  );
  const byCode = new Map(acctRows.map((a) => [a.code, a]));
  const kas = byCode.get('1110');
  const infaq = byCode.get('4100');
  const pendapatanLain = byCode.get('4900');
  const saldoAwal = byCode.get('3900');
  const bebanProgram = byCode.get('5200');
  if (!kas || !infaq || !pendapatanLain || !saldoAwal || !bebanProgram) {
    console.error('   ✗ akun wajib tidak lengkap (1110/4100/4900/3900/5200)');
    process.exit(1);
  }
  console.log(`   ✓ Kas=${kas.code} Infaq=${infaq.code} PendapatanLain=${pendapatanLain.code} SaldoAwal=${saldoAwal.code} BebanProgram=${bebanProgram.code}`);

  console.log('\n3. Resolve/siapkan transaction_categories...');
  const catDefs: Array<{
    code: string;
    name: string;
    direction: 'income' | 'expense';
    debitAccountId: string | undefined;
    creditAccountId: string | undefined;
  }> = [
    { code: 'PCA-INFAQ', name: 'Infaq Anggota & Donatur', direction: 'income', debitAccountId: undefined, creditAccountId: infaq.id },
    { code: 'PCA-PDPT-LAIN', name: 'Penerimaan Lain-lain', direction: 'income', debitAccountId: undefined, creditAccountId: pendapatanLain.id },
    { code: 'PCA-BEBAN-PROGRAM', name: 'Beban Program & Kegiatan', direction: 'expense', debitAccountId: bebanProgram.id, creditAccountId: undefined },
  ];
  const catIds = new Map<string, string>();
  if (apply) {
    for (const c of catDefs) {
      const existing = await withTenant(tenant.id, (db) =>
        db.select().from(transactionCategories).where(and(eq(transactionCategories.tenantId, tenant.id), eq(transactionCategories.code, c.code))),
      );
      if (existing[0]) {
        catIds.set(c.code, existing[0].id);
        continue;
      }
      const [ins] = await withTenant(tenant.id, (db) =>
        db.insert(transactionCategories).values({
          tenantId: tenant.id,
          code: c.code,
          name: c.name,
          direction: c.direction,
          debitAccountId: c.debitAccountId,
          creditAccountId: c.creditAccountId,
        }).returning({ id: transactionCategories.id }),
      );
      catIds.set(c.code, ins!.id);
    }
    console.log(`   ✓ ${catIds.size} kategori siap`);
  } else {
    console.log('   (dry-run — kategori akan dibuat saat --apply)');
    for (const c of catDefs) catIds.set(c.code, `<akan-dibuat:${c.code}>`);
  }

  console.log('\n4. Rencana per baris (dry-run preview, 8 baris pertama + 3 terakhir):');
  const plan = ROWS.map((r) => {
    const isOpening = r.no === 1;
    const isIncome = r.masuk > 0;
    const amount = isIncome ? r.masuk : r.keluar;
    const categoryCode = isOpening ? null : isIncome ? (OTHER_INCOME_ROWS.has(r.no) ? 'PCA-PDPT-LAIN' : 'PCA-INFAQ') : 'PCA-BEBAN-PROGRAM';
    const otherAccount = isOpening ? saldoAwal : isIncome ? (OTHER_INCOME_ROWS.has(r.no) ? pendapatanLain : infaq) : bebanProgram;
    return { r, isIncome, amount, categoryCode, otherAccountId: otherAccount.id, otherAccountCode: otherAccount.code, otherAccountName: otherAccount.name };
  });
  const preview = [...plan.slice(0, 8), ...plan.slice(-3)];
  for (const p of preview) {
    const dir = p.isIncome ? `Debit Kas / Kredit ${p.otherAccountCode}` : `Debit ${p.otherAccountCode} / Kredit Kas`;
    console.log(`   #${p.r.no} ${p.r.date} Rp${p.amount.toLocaleString('id-ID')} — ${p.r.description} [${dir} · ${p.otherAccountName}]`);
  }
  console.log(`   ... total ${plan.length} baris`);

  const incomeCount = plan.filter((p) => p.isIncome).length;
  const expenseCount = plan.length - incomeCount;
  console.log(`\n   Ringkasan: ${incomeCount} penerimaan, ${expenseCount} pengeluaran, ${OTHER_INCOME_ROWS.size} ditandai "Penerimaan Lain-lain" (bukan infaq: baris ${[...OTHER_INCOME_ROWS].join(', ')})`);

  if (!apply) {
    console.log('\nDRY RUN selesai — tidak ada yang ditulis ke database. Jalankan ulang dengan --apply untuk memposting.');
    await pool.end();
    return;
  }

  console.log('\n5. APPLY: memposting transaksi...');
  let inserted = 0;
  let skipped = 0;
  for (const p of plan) {
    const referenceNo = `PCA-KAS-${String(p.r.no).padStart(3, '0')}`;
    const date = parseDdMmYyyy(p.r.date);

    const already = await withTenant(tenant.id, (db) =>
      db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.tenantId, tenant.id), eq(transactions.referenceNo, referenceNo))),
    );
    if (already[0]) {
      skipped++;
      continue;
    }

    const lines = p.isIncome
      ? [
          { accountId: kas.id, debit: String(p.amount), credit: '0' },
          { accountId: p.otherAccountId, debit: '0', credit: String(p.amount) },
        ]
      : [
          { accountId: p.otherAccountId, debit: String(p.amount), credit: '0' },
          { accountId: kas.id, debit: '0', credit: String(p.amount) },
        ];

    await withTenant(tenant.id, async (db) => {
      const transactionNo = await allocateAccountingNumber({ tx: db, tenantId: tenant.id, tenantSlug: tenant.slug, date, kind: 'transaction' });
      const [tx] = await db.insert(transactions).values({
        tenantId: tenant.id,
        transactionNo,
        transactionDate: date,
        categoryId: p.categoryCode ? catIds.get(p.categoryCode)! : null,
        amount: String(p.amount),
        description: p.r.description,
        referenceNo,
        status: 'posted',
        createdBy: ACTOR_USER_ID,
        postedBy: ACTOR_USER_ID,
        postedAt: new Date(),
      }).returning({ id: transactions.id });

      await db.insert(transactionLines).values(lines.map((l, i) => ({ transactionId: tx!.id, ...l, sortOrder: i })));

      const journalNo = await allocateAccountingNumber({ tx: db, tenantId: tenant.id, tenantSlug: tenant.slug, date, kind: 'journal' });
      const [j] = await db.insert(journals).values({
        tenantId: tenant.id,
        journalNo,
        journalDate: date,
        transactionId: tx!.id,
        description: p.r.description,
        createdBy: ACTOR_USER_ID,
      }).returning({ id: journals.id });
      await db.insert(journalLines).values(lines.map((l, i) => ({ journalId: j!.id, ...l, sortOrder: i })));

      await db.insert(approvalLogs).values({
        transactionId: tx!.id,
        userId: ACTOR_USER_ID,
        action: 'import_post',
        notes: `import buku kas PCA Ponjong; sumber baris #${p.r.no}`,
      });
    });
    inserted++;
  }
  console.log(`   ✓ ${inserted} transaksi diposting, ${skipped} dilewati (sudah ada)`);

  console.log('\n6. Verifikasi saldo Kas hasil posting...');
  const balRows = await withTenant(tenant.id, (db) =>
    db
      .select({ debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .where(eq(journalLines.accountId, kas.id)),
  );
  const kasBalance = balRows.reduce(
    (acc, l) => acc.plus(new Decimal(l.debit)).minus(new Decimal(l.credit)),
    new Decimal(0),
  );
  console.log(`   Saldo Kas (dari journal_lines): Rp${kasBalance.toNumber().toLocaleString('id-ID')} (ekspektasi Rp${running.toLocaleString('id-ID')})`);
  if (!kasBalance.eq(running)) {
    console.error('   ✗ SALDO TIDAK COCOK — periksa manual sebelum dipakai!');
  } else {
    console.log('   ✓ cocok.');
  }

  console.log('\n✅ Selesai.');
  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ Gagal:', e);
  await pool.end();
  process.exit(1);
});
