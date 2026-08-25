# Transparansi Keuangan Umum — Design Spec

**Tanggal:** 2026-08-25
**Status:** Disetujui user (via `/goal`), lanjut implementasi.
**Pemicu:** User (pengelola PCA Ponjong) minta laporan keuangan yang bisa dilihat jamaah/anggota —
posisi kas sekarang, kategori pemasukan & pengeluaran terbesar — dan bisa di-share ke WA sebagai
gambar, plus link ke detail. PCA Ponjong (edisi `yayasan`) tidak punya Dana PSAK 109, jadi fitur
"Transparansi Dana PAP" yang sudah ada (satu Dana spesifik) tidak bisa dipakai — kartunya tampil
"Belum ada dana" (lihat screenshot awal permintaan).

## Keputusan yang sudah dikonfirmasi user

| Pertanyaan | Keputusan |
|---|---|
| Audiens | Link publik tanpa login (sama seperti Transparansi Dana PAP) |
| Share ke WA | Download gambar manual — **bukan** integrasi WhatsApp Business API |
| Transparansi Dana PAP lama | Tetap ada, berdampingan — tidak dihapus/diganti |
| Periode data | Default bulan berjalan, admin/pengunjung bisa ganti periode |

## Cakupan

Fitur baru **"Transparansi Keuangan Umum"**, paralel dengan "Transparansi Dana PAP" yang sudah ada,
untuk seluruh tenant (bukan cuma PCA Ponjong) — tidak terikat Dana/fund.

3 angka utama untuk 1 periode:
1. **Posisi Kas Saat Ini** — saldo akun kas+bank+setara kas (kode `11xx`, konvensi yang sama dengan
   laporan Arus Kas yang sudah ada) di akhir periode.
2. **Kategori Pemasukan Terbesar** — dikelompokkan per `transaction_categories` (bukan per akun COA),
   supaya namanya manusiawi ("Infaq Anggota & Donatur") dan tetap detail meski chart of account-nya
   sederhana (kasus PCA Ponjong: cuma 3 akun total, jadi breakdown per-akun tidak informatif).
3. **Kategori Pengeluaran Terbesar** — sama, arah `expense`.

**Di luar cakupan (sengaja tidak dikerjakan):** integrasi WhatsApp otomatis, sistem login/akun
"Anggota" baru, perubahan apa pun ke Transparansi Dana PAP yang sudah ada, kategori baru selain
top-1 pada gambar (halaman publik boleh tampilkan beberapa kategori teratas, gambar WA cukup 1 saja
per arah supaya tetap ringkas & jelas dibaca di ukuran thumbnail WA).

## Arsitektur — mengikuti pola `public-pap` yang sudah terbukti jalan

### Backend

- **Migrasi** `backend/src/db/migrations/sql/097_public_finance_reports.sql` — tabel baru
  `public_finance_reports` (mirror `public_pap_reports`, minus kolom `fundId`): `tenant_id` (PK),
  `is_published`, `published_at`, `published_by`, `revoked_at`, `revoked_by`, `created_at`,
  `updated_at`. Idempoten (`CREATE TABLE IF NOT EXISTS`), additive-only.
- **Schema** `backend/src/db/schema/accounting.ts` — tambah `publicFinanceReports` pgTable + type
  export, sejajar `publicPapReports`.
- **Query baru** `backend/src/modules/accounting/reports/services/category-breakdown.ts` —
  `buildTopCategories({tenantId, period})`: `SELECT ... FROM transactions t JOIN
  transaction_categories tc ON tc.id = t.category_id WHERE t.status='posted' AND t.deleted_at IS
  NULL AND t.transaction_date BETWEEN ... GROUP BY tc.id ORDER BY SUM(t.amount) DESC`, displit per
  `tc.direction` (income/expense) di JS, ambil top 5 tiap arah (halaman publik tampilkan beberapa,
  gambar WA pakai top 1 saja). Transaksi tanpa kategori otomatis ter-exclude (inner join) — cukup,
  tidak perlu penanganan khusus.
- **Posisi kas**: pakai ulang `buildCashFlow(...).closingCash` yang sudah ada (tidak ada query
  baru) — closing cash pada akhir periode yang dipilih; kalau periode = bulan berjalan, ini otomatis
  = saldo hari ini (tidak ada transaksi bertanggal masa depan).
- **Service baru** `backend/src/modules/accounting/public-finance/{service,route,types}.ts` — mirror
  1:1 struktur `public-pap/`: `getPublicFinanceStatus`, `publishPublicFinance`, `revokePublicFinance`
  (permission `reports.publish`, tanpa perlu `fundId`), `buildPublicFinanceReport` (compose
  `buildCashFlow` + `buildTopCategories` + profil lembaga, cache 5 menit via `memory-cache.ts` sama
  seperti pola lama).
- **Endpoint publik baru**, mount di `app.ts`: `app.route('/api/public/keuangan',
  publicFinanceRoute)` — `GET /` (query `month`/`year` atau `startDate`/`endDate`, format
  `json`|`image`), tanpa auth, rate-limited (pakai middleware `rateLimit` yang sudah ada), header
  `Cache-Control: no-store`.
- **Endpoint admin baru** di `reports/route.ts` (tambahan pada `reportsRoute` yang sudah ada):
  `GET /public-finance`, `POST /public-finance/publish`, `POST /public-finance/revoke` — mirror blok
  `/public-pap/*` yang sudah ada, permission sama (`reports.read` / `reports.publish`).
- **Render gambar**: `backend/src/modules/accounting/public-finance/export-image.ts` —
  `renderPublicFinanceImage(report)`: bangun HTML card (potrait, ~1080×1350, cocok utk WA
  chat/status) berisi logo+nama lembaga, label periode, 3 angka utama, dan URL halaman publik
  tercetak sebagai teks di bagian bawah — lalu `page.screenshot({type:'png'})` via Puppeteer.
  **Refactor kecil**: pindahkan `getBrowser()` dari `reports/export/pdf.ts` ke
  `reports/export/browser.ts` supaya dipakai bersama oleh PDF export dan image export (satu
  instance Chromium, bukan dua) — satu-satunya perubahan pada kode PDF yang sudah ada, murni
  pemindahan fungsi tanpa ubah perilaku.

### Frontend

- **Router** (`frontend/src/router/index.ts`): tambah `/transparansi` dan
  `/transparansi/:tenantSlug` (tanpa suffix `/pap`) → `PublicFinanceView.vue` baru, `meta: {
  public: true }`. Tidak bentrok dengan `/transparansi/pap` & `/transparansi/:tenantSlug/pap` yang
  sudah ada (vue-router memprioritaskan segmen statis `pap` di atas parameter dinamis, dan path baru
  ini satu segmen lebih pendek).
- **Halaman publik baru** `frontend/src/features/public-finance/PublicFinanceView.vue` — mirror
  struktur `PublicPapView.vue`: header nama/logo lembaga, picker periode sendiri (default bulan
  berjalan), 3 kartu angka (Posisi Kas / Pemasukan Terbesar / Pengeluaran Terbesar) + daftar
  ringkas kategori berikutnya, tombol "Unduh Gambar" (`<a>` ke endpoint `format=image`), catatan
  privasi di footer (mirip disclaimer Dana PAP).
- **Kartu admin baru** di `ReportsView.vue`, ditempatkan setelah kartu "Transparansi Dana PAP" yang
  sudah ada: judul "Transparansi Keuangan Umum", toggle Publikasikan/Cabut (tanpa perlu pilih Dana),
  status badge, link publik + tombol Salin/Buka setelah publish, dan tombol "Unduh Gambar" (aktif
  hanya kalau sudah dipublikasikan — supaya link yang tercetak di gambar selalu valid).
- **Bug fix** (ditemukan di screenshot awal permintaan user): `ReportsView.vue` fungsi `load()` tidak
  punya guard "jangan fetch kalau mode Custom tapi tanggal belum lengkap" — beda dengan
  `PublicPapView.vue` yang sudah benar (`if (periodMode.value==='custom' && (!dateFrom||!dateTo))
  return;`). Efeknya: begitu pindah ke mode Custom, request langsung terkirim tanpa `startDate`
  /`endDate` maupun `month`/`year` valid → backend balas error mentah "month must be 1..12". Fix:
  tambahkan guard yang sama di `ReportsView.vue`, ganti jadi pesan ramah "Pilih tanggal dari dan
  sampai terlebih dahulu" saat tanggal belum lengkap.
- **Changelog**: tambah 1 entri di `ChangelogView.vue` mengikuti pola entri "Transparansi publik
  Dana PAP" yang sudah ada.

## Data & privasi

Sama seperti Dana PAP: halaman publik & gambar HANYA menampilkan angka ringkasan (posisi kas, nama
+ jumlah kategori teratas) — tidak ada nomor bukti, nama akun COA, ID transaksi, atau catatan
internal apa pun. Response `Cache-Control: no-store`.

## Testing

- Unit test baru untuk `buildTopCategories` (kasus: tanpa transaksi, transaksi tanpa kategori
  ter-exclude, urutan DESC benar) — mirror gaya test yang sudah ada di modul reports/pap-ocr.
- Manual verification: jalankan dev server, cek kartu admin & halaman publik untuk tenant PCA
  Ponjong (yang punya data nyata), pastikan gambar ke-generate dan bisa dibuka.
