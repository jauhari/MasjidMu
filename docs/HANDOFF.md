# Handoff — MasjidMu v2 / MizanMu

**Tanggal:** 2026-08-25
**Branch aktif:** `main` (belum dipush ke `origin/main` — lihat §4)
**Domain Produksi:** Frontend `https://mizanmu.pages.dev`, Backend `https://masjidmu-backend.onrender.com`
**Stack:** Vue 3 + Vite + Reka UI + Cloudflare Pages (frontend), Hono + Better-Auth + Drizzle + Neon PostgreSQL / Render (backend)

---

## 1. Ringkasan Sesi Terakhir (Transparansi Keuangan Umum + fix Mat-View Basi)

Sesi ini membangun fitur baru **"Transparansi Keuangan Umum"**: ringkasan keuangan seluruh lembaga (posisi kas + kategori pemasukan/pengeluaran terbesar) yang bisa dipublikasikan sebagai link publik tanpa login dan diunduh sebagai gambar PNG untuk di-share ke WhatsApp. Berdampingan dengan "Transparansi Dana PAP" yang sudah ada — fitur itu **tidak diubah**, tetap butuh Dana PSAK 109, dan karena itu tidak bisa dipakai tenant seperti **PCA Ponjong** (edisi `yayasan`, 0 dana aktif) yang justru jadi pemicu permintaan fitur ini.

| Area | Ringkasan |
|---|---|
| **Fitur baru: Transparansi Keuangan Umum** | Tabel baru `public_finance_reports` (mirror `public_pap_reports` minus `fundId`). Modul baru `backend/src/modules/accounting/public-finance/{types,service,export-image,route}.ts`. Endpoint publik `GET /api/public/keuangan` (json/image), endpoint admin `GET/POST /api/v1/reports/public-finance{,/publish,/revoke}` (permission `reports.read`/`reports.publish`, sudah ada — tidak ada permission baru). |
| **Kategori terbesar — query baru** | `backend/src/modules/accounting/reports/services/category-breakdown.ts` — `buildTopCategories()` group by `transaction_categories` (bukan akun COA), supaya nama-nya manusiawi dan tetap detail meski chart of account tenant sederhana (PCA Ponjong cuma punya 3 akun total — breakdown per-akun tidak informatif). |
| **Posisi kas** | Pakai ulang `buildCashFlow(...).closingCash` yang sudah ada — tidak ada query baru. |
| **Gambar untuk WA** | `page.screenshot({type:'png'})` via Puppeteer, HTML card 1080×1350 racikan sendiri (`export-image.ts`). Browser Puppeteer di-extract jadi shared module `reports/export/browser.ts`, dipakai bareng oleh export PDF (`export/pdf.ts`, refactor murni — perilaku tidak berubah) dan export PNG baru — satu instance Chromium, bukan dua. |
| **Frontend** | Kartu admin baru "Transparansi Keuangan Umum" di `ReportsView.vue` (sejajar kartu Dana PAP, state independen). Halaman publik baru `features/public-finance/PublicFinanceView.vue` di route `/transparansi/:tenantSlug` (root, tanpa suffix `/pap` — supaya `/pap` tetap khusus Dana PAP). |
| **Bug fix: "month must be 1..12"** | Ditemukan dari screenshot permintaan user: begitu `ReportsView.vue` pindah ke mode periode "Custom" sebelum tanggal diisi, `load()` langsung fetch dengan `month`/`year` kosong → backend balas error mentah. `PublicPapView.vue` sudah punya guard yang benar (`if periodMode==='custom' && (!dateFrom||!dateTo)) return`) — `ReportsView.vue` tidak. Ditambahkan guard yang sama. |
| **Bug lama ketemu & diperbaiki: `mv_account_balances` basi sejak Des 2025** | Saat verifikasi, `buildCashFlow` untuk PCA Ponjong balas Rp4.312.000 (angka Des 2025) padahal saldo riil (dihitung langsung dari `journal_lines`) adalah Rp6.610.000. Materialized view `mv_account_balances` ternyata **tidak pernah ter-refresh sejak Desember 2025** — persis bug cron yang sudah diketahui & di-flag sebagai follow-up di sesi sebelumnya (lihat §5 lama, "Cron 'Refresh materialized views' terus gagal"). **Root cause cron itu sendiri BELUM diselidiki** (masih di luar scope sesi ini) — tapi karena angka basi ini langsung memengaruhi fitur baru (transparansi publik yang salah angka = masalah kepercayaan, bukan cuma kosmetik), dilakukan `REFRESH MATERIALIZED VIEW CONCURRENTLY` manual (mv_account_balances + mv_monthly_summary) via Neon MCP — sama seperti workaround sesi sebelumnya. **Semua tenant diuntungkan** dari refresh ini (laporan Arus Kas & Aktivitas siapa pun yang datanya menyentuh 2026 sebelumnya juga ikut basi), bukan cuma PCA Ponjong. Refresh cron GH Actions yang mendasarinya **masih rusak** — lihat §3. |
| **Data quality PCA Ponjong Agustus 2026** | 4 transaksi tertanggal Agustus 2026 (Infaq Anggota, Infaq kaleng, kegiatan Jalan sehat, pengembalian konsumsi) **semuanya tanpa kategori** (`category_id NULL`) — beda dari 75 baris impor historis yang sengaja dikategorikan rapi. Efeknya: kartu "Kategori Terbesar" bulan berjalan tampil "Belum ada data" (fallback UI sudah benar, bukan bug) sampai transaksi-transaksi ini dikategorikan manual. |

---

## 2. Verifikasi yang Dilakukan

Tidak berhasil menjalankan `pnpm --filter @masjidmu/backend dev` (`tsx watch`) via harness preview tool — proses jalan (PID hidup, tidak crash) tapi **tidak pernah listen di port 3001** dalam >45 detik, dua kali percobaan, tanpa error log sama sekali. **Root cause belum ditemukan** (dugaan: interaksi `tsx watch` + spawn bertingkat `pnpm -C ... --filter ... dev` yang khas Windows — lihat komentar soal EADDRINUSE retry di `src/index.ts`). **Bukan disebabkan perubahan sesi ini**: kode yang sama, dijalankan via `pnpm tsx <script>.ts` biasa (bukan `watch`) atau via `node dist/src/index.js` (compiled), langsung listen instan (`READY after 0s`) — jadi murni gejala mode *watch*, bukan bug aplikasi. Kalau mau lanjut pakai `pnpm dev` untuk iterasi, ini layak diselidiki lebih jauh; untuk sementara `node dist/src/index.js` (setelah `pnpm build`) adalah workaround yang terbukti jalan.

Karena itu, verifikasi dilakukan lewat kombinasi jalur lain (semua terhadap database produksi Neon yang sesungguhnya, project **"MasjidMu"** / `weathered-heart-75887530`, tenant PCA Ponjong nyata):

1. **Query kategori-terbesar** dijalankan langsung via SQL terhadap data PCA Ponjong asli → hasil cocok 100% dengan tabel kategorisasi di HANDOFF lama (`PCA-INFAQ` teratas utk income, `PCA-BEBAN-PROGRAM` teratas utk expense).
2. **Render gambar** diuji 2×: sekali dengan data buatan (angka historis Rp4.312.000), sekali lewat `app.fetch()` in-process dengan header proxy tenant yang ditandatangani HMAC secara sah (mensimulasikan Cloudflare Function yang di produksi menerjemahkan `?tenant_slug=` jadi header `x-mizanmu-tenant-{slug,ts,sig}` — lihat `middleware/tenant.ts`) → PNG 1080×1350 valid, terbaca visual, layout benar termasuk fallback "Belum ada data".
3. **Endpoint publik penuh** (`GET /api/public/keuangan`, format json & image) dieksekusi via `app.fetch()` in-process (bukan lewat port asli — lihat kendala di atas) dengan header proxy sah → 200 dengan angka benar (setelah refresh mat-view), 400 rapi untuk periode invalid, 404 rapi untuk tenant tidak dikenal.
4. **Halaman publik di browser sungguhan** (`http://localhost:5173/transparansi/pca-ponjong`, via `node dist/src/index.js` + Vite dev server asli) → header, badge periode (default bulan berjalan), dan 3 combobox period-picker semua render benar. Fetch data gagal dengan `tenant_context_required` — **tapi ini bukan bug baru**: halaman `/transparansi/pca-ponjong/pap` yang SUDAH LIVE di produksi menunjukkan galat identik dalam kondisi lokal yang sama (query param `tenant_slug` sengaja tidak dipercaya untuk rute `/api/public/*`, cuma subdomain asli atau header proxy bertanda tangan — lihat `tenantResolver` di `middleware/tenant.ts`). Jadi baik fitur lama maupun baru sama-sama hanya bisa diuji penuh di produksi (lewat Cloudflare Function) atau lewat header proxy yang ditandatangani manual seperti poin 3.
5. **Kartu admin** (tombol Publikasikan/Cabut/Unduh Gambar di `ReportsView.vue`) **tidak diklik langsung di browser** — perlu sesi login sungguhan (Google OAuth, tidak ada kredensial; atau email+password, tidak ada user test siap pakai tanpa membuat akun baru di database produksi). Percaya diri tinggi tapi tidak 100% teruji-visual: kode mengikuti pola kartu Dana PAP yang sudah terbukti jalan di produksi hampir persis 1:1 (nama fungsi, struktur state, endpoint shape), `pnpm typecheck` + `pnpm build` bersih di kedua paket.
6. Semua data uji coba (publish flag PCA Ponjong) **sudah dikembalikan ke `is_published=false`** setelah verifikasi — tidak ada state tersisa yang tidak diinginkan.

---

## 3. Follow-up yang Direkomendasikan

1. **Selidiki root cause cron refresh materialized view** (GH Actions `.github/workflows/cron-refresh-mv.yml` terus gagal) — masih belum diselidiki, sudah 2 sesi berturut cuma di-workaround manual. Kalau ini tidak diperbaiki, SEMUA laporan yang bergantung `mv_account_balances`/`mv_monthly_summary` (Arus Kas, Aktivitas, dan sekarang Transparansi Keuangan Umum) berisiko menampilkan angka basi untuk tenant mana pun yang datanya terus bertambah.
2. **Kategorikan 4 transaksi PCA Ponjong Agustus 2026** yang belum ada kategorinya (lihat §1) — supaya kartu "Kategori Terbesar" tidak kosong utk bulan berjalan.
3. **Uji kartu admin Transparansi Keuangan Umum di browser sungguhan** dengan akun asli (lihat §2.5) — belum pernah diklik langsung, meski sangat mirip pola Dana PAP yang sudah terbukti.
4. **Push ke `origin/main`** — semua kerja sesi ini baru committed lokal (4 commit, lihat §4), belum dipush/dideploy. Perlu keputusan/aksi eksplisit user.
5. **Selidiki kenapa `pnpm --filter @masjidmu/backend dev` (tsx watch) gantung** tanpa listen di Windows (lihat §2) — mengganggu alur iterasi lokal normal; `node dist/src/index.js` adalah workaround sementara.
6. Follow-up lama yang masih berlaku (belum tersentuh sesi ini): konfirmasi `ANTHROPIC_API_KEY` di Render, lanjutan impor data tulisan tangan PCA Ponjong, CI Lint frontend, verifikasi Google Login dengan akun asli — lihat riwayat di §6.

---

## 4. Commit Sesi Ini (lokal, `main`, belum dipush)

- `1c18292` `docs: add design spec for Transparansi Keuangan Umum`
- `64f5465` `docs: add implementation plan for Transparansi Keuangan Umum`
- `cb4c342` `feat(reports): add Transparansi Keuangan Umum backend module`
- `378da07` `feat(reports): add Transparansi Keuangan Umum admin card + public page`

File utama: `backend/src/db/migrations/sql/097_public_finance_reports.sql`, `backend/src/modules/accounting/public-finance/*`, `backend/src/modules/accounting/reports/services/category-breakdown.ts`, `backend/src/modules/accounting/reports/export/browser.ts`, `frontend/src/features/public-finance/PublicFinanceView.vue`, `frontend/src/features/reports/ReportsView.vue`.

Migrasi `097` sudah **diterapkan langsung ke database produksi Neon** (project `weathered-heart-75887530`) via Neon MCP — additive-only (`CREATE TABLE IF NOT EXISTS`), diverifikasi kolom-per-kolom cocok dengan schema Drizzle. `backend/.env` lokal baru dibuat (di-gitignore, tidak masuk commit) berisi kredensial dev yang sama dengan `current-envvars.json` di root proyek, plus `BETTER_AUTH_URL=http://localhost:3001` (bukan domain produksi) dan `PUBLIC_TENANT_PROXY_SECRET` baru (dipakai murni utk simulasi header proxy saat verifikasi lokal, lihat §2).

---

## 5. Konfigurasi Environment

Tidak ada perubahan environment variable produksi sesi ini. Checklist Render lama (§ lama, masih berlaku semua) belum diperiksa ulang.

---

## 6. Riwayat Handoff Sebelumnya (ringkas)

<details>
<summary>2026-08-25 (awal hari, sebelum sesi ini) — Google Login Root Cause, Onboarding PCA Ponjong, Impor Rekapan Kas</summary>

### Google Login — root cause sebenarnya

Root cause: **service worker PWA** (`navigateFallback: '/index.html'` tanpa denylist) mencegat **semua navigasi top-level**, termasuk redirect callback Google — request itu tidak pernah sampai ke backend. Fix: `navigateFallbackDenylist: [/^\/api\//]` di `vite.config.ts`. Detail alur OAuth end-to-end, verifikasi navigasi asli vs `fetch()`, dan fix-fix pendukung (errorCallbackURL, router guard query error) — lihat commit `fc466f5`, `fdd0ec0`, `9ab5851`. **Belum diverifikasi** dengan akun Google asli.

### PCA Ponjong — Onboarding & Import Data Historis

Tenant `pca-ponjong`, edisi `yayasan` (tanpa Dana PSAK 109). 75 transaksi historis (26 Agu 2023 – 10 Des 2025) dari Google Sheet, ditranskripsi manual + divalidasi silang, diposting via `backend/scripts/import-pca-ponjong-kas.ts` (dry-run default). Kategorisasi: `PCA-INFAQ` (Infaq Anggota & Donatur → 4100), `PCA-PDPT-LAIN` (Penerimaan Lain-lain → 4900), `PCA-BEBAN-PROGRAM` (Beban Program & Kegiatan → 5200). Saldo Kas akhir saat itu Rp4.312.000. **Data lanjutan** (foto tulisan tangan, saldo awal = saldo akhir di atas) direkomendasikan diimpor lewat UI "Impor Rekapan Kas", bukan script manual.

### PAP Import (sekarang "Impor Rekapan Kas") — perbaikan

Live progress timer saat OCR, timeout upload 120s→300s, pesan error timeout digeneralisasi (bukan lagi nyaranin cek port 3001 di production), model OCR Opus 4.8→Sonnet 5 (hemat token), Dana jadi opsional (tidak wajib utk tenant tanpa Dana aktif), tombol disabled kasih alasan jelas. `ANTHROPIC_API_KEY` ditambahkan ke `render.yaml` (dokumentasi saja, nilai diisi manual di Render Dashboard oleh user — **belum dikonfirmasi berhasil**). Rename user-facing "Impor Rekapan PAP"→"Impor Rekapan Kas" (URL/kode/endpoint internal sengaja tidak diubah).

Commit: `e93ca4a`, `f3386d2`, `ff7f1d0`, `4c45bc0`, `a629652`, `7245c49`.

</details>

<details>
<summary>2026-08-25 (lebih awal lagi) — Transparansi Publik Dana PAP, Impor Rekapan PAP (awal), Dashboard Arus Kas</summary>

#### Transparansi publik Dana PAP

Admin dengan izin `reports.publish` bisa memilih satu Dana PAP untuk dipublikasikan; jamaah membuka halaman read-only tanpa login untuk melihat ringkasan, mutasi anonim, dan PDF laporan periode yang dipilih.

Endpoint: `GET /api/v1/reports/public-pap` (status), `POST .../publish` (body `{fundId}`, perlu `reports.publish`), `POST .../revoke`. Data publik hanya nama/logo masjid, periode, saldo awal/akhir, penerimaan/penyaluran, dan mutasi anonim (tanpa nomor bukti/akun/donor/ID transaksi). Response `Cache-Control: no-store`.

File utama: `backend/src/db/migrations/sql/096_public_pap_reports.sql`, `backend/src/modules/accounting/public-pap/{service,route,export}.ts`, `frontend/src/features/public-pap/PublicPapView.vue`, `frontend/src/features/reports/ReportsView.vue`.

Commit: `c38b091`, `4a0d1c9`, `a757efb`, `3103d47`, `037ea2f`.

> Catatan domain: dokumentasi asli memakai `hisabmu.pages.dev` — domain produksi sekarang `mizanmu.pages.dev`/`mizanmu.id`, URL lama kemungkinan sudah tidak berlaku.

#### Impor Rekapan PAP (sekarang "Impor Rekapan Kas")

Impor Excel atau 1–5 foto JPEG/PNG/WebP untuk satu dana. OCR (awalnya Claude Opus 4.8, lalu Sonnet 5) hanya mentranskripsi; keputusan akun/dana dan posting tetap lewat review operator. Validasi MIME/signature/ukuran/fingerprint mencegah input salah/duplikat. Batch posting atomik + idempoten + audit trail.

File utama: `frontend/src/features/transactions/PapImportView.vue`, `backend/src/modules/accounting/transactions/{pap-import,pap-ocr,pap-commit}.ts`, `backend/src/db/migrations/sql/095_accounting_import_batches.sql`, `docs/PAP_IMPORT.md`.

Commit: `59c569b`, `bff6ff4`.

#### Dashboard arus kas & CoA

`DashboardView.vue` menampilkan arus kas 12 bulan lintas tahun (bulan terbaru auto-terpilih, hover untuk detail, keyboard + scroll horizontal). Commit: `619a7fc`. Picker akun induk (`ParentAccountSelect.vue`) menampilkan kode/nama/kedalaman hierarki sebagai absolute overlay.

#### Cara menjalankan lokal

```bash
# dari masjidmu-v2/
pnpm --filter @masjidmu/backend dev    # :3001 -- lihat §2 sesi terbaru: kalau gantung, coba `pnpm build && node dist/src/index.js`
pnpm --filter @masjidmu/frontend dev   # :5173
pnpm --dir frontend typecheck
pnpm --dir frontend build
```

</details>

<details>
<summary>2026-07-01</summary>

Modul konten: event recurrence, perbaikan submit event/list duplikat, mass edit Program/Event/Berita/Pengumuman/Galeri, dan redesign form Event. Implementasinya masih ada; untuk detail historis gunakan git sebelum pembaruan handoff ini.

</details>
