<script setup lang="ts">
import {
  GitCommitHorizontal,
  Palette,
  Wrench,
  Sparkles,
  Database,
  ExternalLink,
} from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import PageHeader from '@/shared/ui/PageHeader.vue';
import { cn } from '@/lib/utils';

interface ChangeEntry {
  date: string;
  type: 'feature' | 'fix' | 'ui' | 'db';
  title: string;
  description: string;
  files?: string[];
}

const typeBadge: Record<ChangeEntry['type'], { icon: unknown; label: string; cls: string }> = {
  feature: { icon: Sparkles, label: 'Fitur', cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  fix: { icon: Wrench, label: 'Perbaikan', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  ui: { icon: Palette, label: 'UI/UX', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  db: { icon: Database, label: 'Database', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
};

const entries: ChangeEntry[] = [
  {
    date: '2026-07-15',
    type: 'feature',
    title: 'Transparansi publik Dana PAP',
    description:
      'Admin kini dapat mempublikasikan satu Dana PAP dari halaman Laporan Keuangan. Jamaah dapat membuka tautan khusus tanpa login untuk melihat ringkasan saldo, penerimaan, penyaluran, mutasi anonim, serta mengunduh PDF. Publikasi dapat dicabut kapan saja; informasi internal seperti akun, nomor bukti, donor/penerima, dan catatan tidak ditampilkan.',
    files: [
      'features/reports/ReportsView.vue',
      'features/public-pap/PublicPapView.vue',
      'modules/accounting/public-pap/route.ts',
      'modules/accounting/public-pap/service.ts',
      'db/migrations/sql/096_public_pap_reports.sql',
    ],
  },
  {
    date: '2026-07-15',
    type: 'fix',
    title: 'Tautan publik PAP dapat dibagikan dari Pages',
    description:
      'Tautan laporan Dana PAP dari admin kini memakai alamat bersama HisabMu Pages dengan slug lembaga, sehingga tetap terbuka sebelum subdomain produksi tiap lembaga aktif. Route publik juga meneruskan konteks tenant secara aman ke API.',
    files: [
      'features/reports/ReportsView.vue',
      'features/public-pap/PublicPapView.vue',
      'router/index.ts',
      'functions/api/[[path]].ts',
    ],
  },
  {
    date: '2026-07-13',
    type: 'ui',
    title: 'Dashboard — arus kas rolling 12 bulan',
    description:
      'Grafik arus kas kini memuat 12 bulan lintas tahun, dapat digeser di layar kecil, dan setiap bulan dapat dipilih untuk melihat pemasukan, pengeluaran, serta surplus/defisit secara rinci. Dashboard otomatis menyorot bulan terbaru dan laporan ringkas memakai periode aktif saat halaman dimuat.',
    files: ['features/dashboard/DashboardView.vue'],
  },
  {
    date: '2026-07-13',
    type: 'ui',
    title: 'Impor foto PAP — paste, rotasi, dan progres jelas',
    description:
      'Foto rekapan kini dapat ditempel dengan Ctrl+V, orientasi EXIF diperbaiki otomatis, dan gambar dapat diputar 90° sebelum OCR. Progres membedakan unggah file dari pemrosesan OCR; gambar rusak atau isi yang tidak sesuai JPEG/PNG/WebP ditolak lebih awal. Override akun per baris tetap khusus Keluar, sedangkan Masuk memakai akun Pendapatan default batch.',
    files: [
      'features/transactions/PapImportView.vue',
      'shared/api/client.ts',
      'modules/accounting/transactions/pap-ocr.ts',
      'modules/accounting/transactions/route.ts',
      'docs/PAP_IMPORT.md',
    ],
  },
  {
    date: '2026-07-13',
    type: 'feature',
    title: 'Impor Rekapan PAP dari foto atau Excel',
    description:
      'Jalur impor khusus PAP: pilih satu Dana dan mapping Kas/Pendapatan/Beban, periksa hasil ekstraksi sebelum posting, lalu buat transaksi dan jurnal posted secara atomik. Foto memakai Claude Vision hanya untuk transkripsi; OCR tidak pernah memilih akun/dana atau mem-posting tanpa review. Batch memakai fingerprint sumber untuk retry aman tanpa duplikasi dan seluruh journal line membawa tag Dana PSAK 109.',
    files: [
      'features/transactions/PapImportView.vue',
      'modules/accounting/transactions/pap-import.ts',
      'modules/accounting/transactions/pap-ocr.ts',
      'modules/accounting/transactions/pap-commit.ts',
      'db/migrations/sql/095_accounting_import_batches.sql',
    ],
  },
  {
    date: '2026-07-13',
    type: 'db',
    title: 'Audit batch import dan nomor akuntansi aman',
    description:
      'Migration 095 menambah audit batch import PAP dengan RLS, status, fingerprint, dana, alasan, jumlah baris, dan hasil commit. Alokasi nomor transaksi/jurnal kini memakai advisory lock per tenant/periode dan tidak lagi berputar setelah 9999, sehingga impor dan input normal tidak saling menghasilkan nomor duplikat.',
    files: [
      'db/schema/accounting.ts',
      'modules/accounting/transactions/numbering.ts',
      'modules/accounting/transactions/import.ts',
    ],
  },
  {
    date: '2026-07-01',
    type: 'ui',
    title: 'Form Event Baru — layout PRO',
    description:
      'Modal event dirombak: ukuran xl, section berikon (informasi, jadwal, lokasi, publikasi, RSVP), strip pratinjau live, kartu pilihan pengulangan, switch toggle, input berikon, pratinjau cover, RSVP collapsible, error di dalam modal (`modalError`).',
    files: ['features/events/EventsView.vue'],
  },
  {
    date: '2026-07-01',
    type: 'feature',
    title: 'Mass edit modul konten',
    description:
      'Checkbox + bar aksi massal untuk Program, Event, Berita, Pengumuman, dan Galeri. Shared: `useBulkSelection`, `useContentBulkActions`, `ContentBulkBar`, `BulkFieldModal`. Aksi: ubah status/skup, publikkan/sembunyikan, hapus massal. Event: hapus seri berulang via `?scope=series`.',
    files: [
      'shared/composables/useBulkSelection.ts',
      'shared/composables/useContentBulkActions.ts',
      'shared/lib/bulk-actions.ts',
      'shared/ui/ContentBulkBar.vue',
      'shared/ui/BulkFieldModal.vue',
      'features/programs/ProgramsView.vue',
      'features/events/EventsView.vue',
      'features/posts/PostsView.vue',
      'features/announcements/AnnouncementsView.vue',
      'features/galleries/GalleriesView.vue',
    ],
  },
  {
    date: '2026-07-01',
    type: 'fix',
    title: 'Bulk status Pengumuman — pakai publishedAt',
    description:
      'Pengumuman tidak punya kolom `status` (derived dari `publishedAt`). Bulk ubah status sekarang PATCH `publishedAt` (ISO untuk terbit, `null` untuk draft), bukan field status fiktif. Modal bulk status/skup + konfirmasi hapus massal ditambahkan ke template.',
    files: ['features/announcements/AnnouncementsView.vue'],
  },
  {
    date: '2026-07-01',
    type: 'feature',
    title: 'Event berulang (recurrence)',
    description:
      'Buat seri kegiatan: mingguan, selapanan (35 hari), interval hari, bulanan. Opsi tanpa waktu selesai kegiatan dan tanpa tanggal akhir pengulangan (~52 jadwal). Migration 093, generator di `event-recurrence.ts`, list satu baris per seri (`GET ?group=series`), hapus seri (`DELETE ?scope=series`).',
    files: [
      'db/migrations/sql/093_event_recurrence.sql',
      'lib/event-recurrence.ts',
      'modules/content/events/route.ts',
      'features/events/EventsView.vue',
    ],
  },
  {
    date: '2026-07-01',
    type: 'fix',
    title: 'Submit event internal_error — createdBy FK',
    description:
      'POST event gagal karena `createdBy` memakai auth user ID (text) bukan `users.id` UUID tenant. Diperbaiki dengan `findTenantUser()` — pola sama seperti modul transaksi.',
    files: ['modules/content/events/route.ts', 'lib/user-mapping.js'],
  },
  {
    date: '2026-07-01',
    type: 'fix',
    title: 'List event duplikat (104 baris)',
    description:
      'Penyebab: list per occurrence + data uji seri berulang. Fix: GET `group=series` + UI satu baris per seri. Data uji "Test Pengajian Ahad" di-soft-delete.',
    files: ['modules/content/events/route.ts', 'features/events/EventsView.vue'],
  },
  {
    date: '2026-07-01',
    type: 'ui',
    title: 'Modal — scrollbar & layout flex',
    description:
      'Dialog konten panjang (form Event) pakai layout flex + `ScrollArea type="hover"` agar scroll tidak dobel/aneh di dalam modal.',
    files: ['shared/ui/Modal.vue'],
  },
  {
    date: '2026-07-01',
    type: 'ui',
    title: 'Dokumentasi handoff sesi konten',
    description:
      'Ringkasan pekerjaan event + mass edit konten untuk agen/sesi berikutnya. Lihat `docs/HANDOFF.md` di repo.',
    files: ['docs/HANDOFF.md'],
  },
  {
    date: '2026-05-29',
    type: 'ui',
    title: 'Halaman Changelog',
    description:
      'Halaman ini sendiri — tempat mencatat semua perubahan aplikasi. Akses dari link kecil di sidebar kiri bawah.',
    files: ['features/changelog/ChangelogView.vue', 'router/index.ts', 'app/AppShell.vue'],
  },
  {
    date: '2026-05-29',
    type: 'feature',
    title: 'Time picker inline — tanpa klik tambahan',
    description:
      'Panel jam langsung tampil berdampingan dengan kalender. Tidak perlu toggle / klik ikon jam lagi. Pakai `timePickerInline: true` via `:time-config`.',
    files: ['shared/ui/DateTimePicker.vue'],
  },
  {
    date: '2026-05-29',
    type: 'ui',
    title: 'Kalender & time picker: brand teal',
    description:
      'Seluruh datepicker dan time picker (`.dp--theme-light`, `.dp--time-col`, `.dp--inc-dec-button`) kini pakai palet teal brand (`brand-50..700`). Selected date solid teal, hari ini outlined, jam pakai tombol bulat transparan dengan hover teal, kolom jam/menit terpisah dengan colon pseudo-element.',
    files: ['styles.css'],
  },
  {
    date: '2026-05-29',
    type: 'ui',
    title: 'Karakter counter alasan force-edit/delete',
    description:
      'Textarea alasan di modal GOD MODE sekarang punya counter `{n} / 10 minimum` — hijau kalau ≥10, amber kalau kurang. Membantu super admin memenuhi syarat panjang minimal sebelum submit.',
    files: ['features/transactions/TransactionsView.vue'],
  },
  {
    date: '2026-05-29',
    type: 'fix',
    title: 'Error ditampilkan di dalam modal',
    description:
      'Sebelumnya pesan error (validasi & API) di-set ke ref page-level — ketutup backdrop modal. Sekarang tiap modal punya ref error sendiri (`transactionError`, `detailError`, `forceEditError`, `forceDeleteError`, `modalError`) yang di-render di atas form di dalam modal masing-masing. Error lama di-clear saat modal dibuka.',
    files: [
      'features/transactions/TransactionsView.vue',
      'features/transaction-categories/TransactionCategoriesView.vue',
    ],
  },
  {
    date: '2026-05-29',
    type: 'feature',
    title: 'Kategori transaksi: satu akun wajib (PSAK 45)',
    description:
      'Kategori tidak lagi mewajibkan kedua akun (debit & kredit). Aturan baru: untuk Pemasukan, akun kredit WAJIB (akun pendapatan), debit opsional. Untuk Pengeluaran, akun debit WAJIB (akun beban), kredit opsional. Akun kas/bank bisa dipilih saat input transaksi. Hint di form menjelaskan kapan akun opsional.',
    files: [
      'features/transaction-categories/TransactionCategoriesView.vue',
      'features/transactions/TransactionsView.vue',
      'features/transactions/TransactionLineEditor.vue',
    ],
  },
  {
    date: '2026-05-29',
    type: 'db',
    title: 'Migration 070 — nullable account di kategori',
    description:
      'Kolom `debit_account_id` dan `credit_account_id` di `transaction_categories` sekarang nullable. CHECK constraint: `direction=income → credit_account_id NOT NULL`, `direction=expense → debit_account_id NOT NULL`. Drizzle schema + zod validator + companion SQL disesuaikan.',
    files: [
      'db/schema/accounting.ts',
      'db/migrations/sql/070_transaction_categories_optional_accounts.sql',
      'modules/accounting/transaction-categories/route.ts',
    ],
  },
  {
    date: '2026-05-29',
    type: 'feature',
    title: 'AccountSelect — dropdown akun hierarkis',
    description:
      'Komponen shared `<AccountSelect>` menggantikan semua `<select>` akun flat. Akun parent (punya children) di-disable — hanya leaf yang bisa dipilih. Indentasi pakai non-breaking space + `└` glyph. Browser native `<option>` jadi kompatibel dengan semua form handler. Support filter `accountType`, `includeInactive`, `placeholder`.',
    files: [
      'shared/ui/AccountSelect.vue',
      'features/transaction-categories/TransactionCategoriesView.vue',
      'features/transactions/TransactionsView.vue',
      'features/transactions/TransactionLineEditor.vue',
    ],
  },
];
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-6">
    <PageHeader
      title="Changelog"
      description="Rekam jejak perubahan aplikasi HisabMu — supaya semua tahu sudah sampai mana."
      :crumbs="[{ label: 'Dashboard', to: '/' }, { label: 'Changelog' }]"
    />

    <Card>
      <CardContent class="relative pt-6">
        <div class="absolute left-5 top-6 h-[calc(100%-1.5rem)] w-px bg-border" aria-hidden="true" />

        <div class="flex flex-col gap-6">
          <div v-for="(entry, i) in entries" :key="i" class="relative pl-12">
            <div class="absolute left-0 top-1.5 flex h-10 w-10 items-center justify-center rounded-full border-4 border-card bg-card shadow-sm ring-1 ring-border">
              <GitCommitHorizontal class="h-4 w-4 text-muted-foreground" />
            </div>

            <div class="rounded-lg border border-border bg-card p-4">
              <div class="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  :class="cn('text-[0.65rem] font-semibold uppercase tracking-wide', typeBadge[entry.type].cls)"
                >
                  <component :is="typeBadge[entry.type].icon" class="mr-1 inline h-3 w-3" />
                  {{ typeBadge[entry.type].label }}
                </Badge>
                <span class="font-mono text-xs text-muted-foreground">{{ entry.date }}</span>
              </div>

              <h2 class="mt-1.5 text-base font-semibold text-foreground">
                {{ entry.title }}
              </h2>

              <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
                {{ entry.description }}
              </p>

              <div v-if="entry.files?.length" class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span class="text-[0.65rem] uppercase tracking-wide text-muted-foreground">File terkait</span>
                <Badge
                  v-for="f in entry.files"
                  :key="f"
                  variant="secondary"
                  class="font-mono text-[0.65rem] font-normal"
                >
                  {{ f }}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card class="border-dashed">
      <CardHeader class="pb-2">
        <CardTitle class="flex items-center gap-2 text-sm font-normal text-muted-foreground">
          <ExternalLink class="h-3.5 w-3.5" />
          Tips
        </CardTitle>
        <CardDescription>
          Tambahkan entri baru setiap kali selesai mengerjakan fitur, bug fix, atau perubahan konfigurasi — supaya tim selalu sinkron.
        </CardDescription>
      </CardHeader>
    </Card>
  </div>
</template>