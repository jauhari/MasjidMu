# Handoff — MasjidMu v2 / MizanMu

**Tanggal:** 2026-08-25  
**Branch aktif:** `main` (sudah dipush ke `origin/main`)  
**Domain Produksi:** Frontend `https://mizanmu.pages.dev`, Backend `https://masjidmu-backend.onrender.com`  
**Stack:** Vue 3 + Vite + Reka UI + Cloudflare Pages (frontend), Hono + Better-Auth + Drizzle + Neon PostgreSQL / Render (backend)

---

## 1. Ringkasan Sesi Terakhir (Google Login Root Cause + Onboarding PCA Ponjong + Impor Rekapan Kas)

Sesi ini melanjutkan perbaikan **Login dengan Google** dari sesi sebelumnya hari ini (commit `113f39a`/`cf7f0a7`/`c7ab4f6` — lihat §2) — fix-fix itu ternyata belum menyelesaikan masalah sebenarnya. Root cause baru ditemukan dan diperbaiki di sesi ini. Selain itu: onboarding tenant baru **PCA Ponjong** dengan import 75 transaksi historis dari Google Sheet, dan serangkaian perbaikan pada fitur **Impor Rekapan Kas** (sebelumnya bernama "Impor Rekapan PAP").

| Area | Masalah | Solusi / Status |
|---|---|---|
| **Google Login — root cause sebenarnya** | User lapor: redirect ke Google sukses, tapi balik ke app selalu mendarat di halaman login lagi, tanpa pesan error. | **Service worker PWA** (`navigateFallback: '/index.html'` tanpa denylist) mencegat **semua navigasi top-level**, termasuk redirect callback Google (`GET /api/auth/callback/google?...`) — request itu tidak pernah sampai ke backend sama sekali, service worker langsung menyajikan `index.html` dari cache. Fix: `navigateFallbackDenylist: [/^\/api\//]` di `vite.config.ts`. |
| **errorCallbackURL tidak diset** | `signInWithGoogle()` tidak kirim `errorCallbackURL` ke better-auth → error OAuth diarahkan ke halaman error bawaan better-auth (`/api/auth/error`), bukan ke `/login`. | Kirim `errorCallbackURL: origin + '/login'` di `store.ts`. |
| **Router guard menelan query `error`** | Saat better-auth tidak bisa resolve flow (state tidak dikenali), ia fallback redirect ke `baseURL` root dengan `?error=...`. Guard router membungkus SELURUH query jadi param `redirect`, jadi `error` tidak pernah tampil di UI. | `router/index.ts`: forward `to.query.error` sebagai top-level query saat bounce ke `/login`. |
| **PCA Ponjong: 75 transaksi historis** | User minta data Google Sheet buku kas PCA Ponjong dimasukkan ke aplikasi. | Ditranskripsi manual + divalidasi silang (saldo berjalan dihitung ulang independen, cocok 100% di 75/75 baris terhadap kolom Saldo sheet) → diposting via script one-off `backend/scripts/import-pca-ponjong-kas.ts` (dry-run default, idempoten). |
| **Dashboard nunjukkin Rp0 padahal data ada** | Script import PCA Ponjong menulis langsung ke DB (bypass API), jadi tidak memicu refresh `mv_account_balances`/`mv_monthly_summary` yang biasanya otomatis jalan setelah posting via API. | Manual `REFRESH MATERIALIZED VIEW` sekali via Neon MCP. **Perlu perhatian**: cron GH Actions "Refresh materialized views" terus gagal (lihat §6 follow-up) — kalau ini tidak diperbaiki, tenant baru manapun bisa kena masalah serupa. |
| **PAP Import: OCR tanpa indikator progress** | Tombol "Baca & periksa rekapan" cuma spinner statis saat OCR jalan (bisa sampai 2 menit) — user tidak tahu apakah masih jalan atau macet. | Tambah penghitung waktu berjalan ("N detik") yang update tiap detik di `PapImportView.vue`. |
| **PAP Import: timeout 2 menit terlalu ketat** | OCR multi-gambar dengan *extended thinking* (Claude) bisa lebih dari 2 menit; client timeout duluan sebelum backend selesai. | `timeoutMs` upload gambar dinaikkan dari 120s → 300s. |
| **Pesan error timeout salah untuk production** | `formatApiError` selalu bilang "pastikan backend jalan di port 3001" — instruksi dev lokal yang nyasar ke semua user, di semua request yang timeout. | Ganti jadi pesan generik: "Waktu tunggu habis sebelum server merespons. Periksa koneksi internet Anda, lalu coba lagi." |
| **Model OCR: Opus 4.8 → Sonnet 5** | Diminta user untuk hemat token — ekstraksi tabel adalah tugas baca data, bukan penalaran kompleks. | `PAP_OCR_MODEL` di `pap-ocr.ts` diganti ke `claude-sonnet-5`. Test terkait (`pap-ocr.test.ts`) disesuaikan, 8/8 tetap hijau. |
| **PAP Import: field Dana wajib padahal tenant tanpa dana** | `mappingsReady` mewajibkan `fundId` unconditional. Tenant non-LAZ (masjid/pesantren/**yayasan** — termasuk PCA Ponjong) punya 0 dana aktif by design → dropdown Dana selalu kosong → tombol baca terkunci **permanen**, tanpa penjelasan. | Dana hanya wajib kalau `activeFunds.length > 0` (`fundRequired` computed baru). Field jadi disabled + hint "Lembaga ini tidak memakai dana (fund) — bagian ini dilewati" saat tidak berlaku. `fundId` dikirim `null` (bukan `''`) ke backend — backend sudah nullable, ini murni gap frontend. |
| **PAP Import: tombol disabled tanpa penjelasan (field akun)** | Pola sama seperti Dana — kalau Akun kas/pemasukan/pengeluaran belum dipilih, tombol nonaktif tanpa keterangan apa pun. | Tambah `missingBeforeParse` computed + teks "Lengkapi dulu: ..." di bawah tombol, list field yang masih kosong. |
| **`ANTHROPIC_API_KEY` hilang dari `render.yaml`** | Satu-satunya secret yang tidak pernah didaftarkan di blueprint (beda dari Google/Resend/R2/dll) → endpoint OCR mengembalikan `503 ocr_not_configured` di production. | Ditambahkan sebagai entri `sync: false` di `render.yaml` untuk dokumentasi. **Nilai aktualnya HARUS diisi manual di Render Dashboard** — Claude tidak pernah menangani/memasukkan API key secara langsung (kebijakan keamanan). User sudah menambahkan sendiri di dashboard; **belum dikonfirmasi berhasil** (lihat §6). |
| **Rebrand "Impor Rekapan PAP" → "Impor Rekapan Kas"** | Nama fitur menyiratkan "khusus PAP", padahal sekarang universal untuk tenant mana pun (terutama setelah fix Dana opsional di atas) — bikin user bingung ("nggak semua ada PAP"). | Label user-facing diganti (tombol, judul halaman, breadcrumb, judul entri changelog). URL (`/transactions/import/pap`), nama file kode, dan endpoint API sengaja **tidak** diubah — nama internal yang user tidak pernah lihat. |

---

## 2. Root Cause Google Login — Detail Teknis

### 2.1 Kenapa fix sesi sebelumnya (`113f39a`/`cf7f0a7`) belum cukup

Fix-fix itu semuanya valid dan tetap diperlukan (account linking, cookie/origin, sync user, dll — lihat riwayat di bawah), tapi tidak menyentuh akar masalah: **request callback OAuth tidak pernah sampai ke Cloudflare Function atau backend sama sekali.**

### 2.2 Cara menemukan root cause

Dibuktikan lewat perbandingan `fetch()` vs navigasi asli ke URL yang identik:

```
fetch('/api/auth/callback/google?state=X&code=Y')      → SELALU sampai backend, diproses benar
navigate('/api/auth/callback/google?state=X&code=Y')   → SELALU "ketelan" — mendarat balik ke
                                                            SPA shell dengan query mentah, seolah
                                                            tidak pernah diproses backend
```

`fetch()` (mode `cors`) tidak match Workbox `navigateFallback`, sementara redirect Google adalah **navigasi browser sungguhan** (mode `navigate`) — persis yang coba di-fallback-kan Workbox ke `index.html`. Root cause: `vite.config.ts` set `navigateFallback: '/index.html'` **tanpa** `navigateFallbackDenylist`, jadi *semua* navigasi top-level (termasuk yang harusnya ke `/api/*`) diservis dari cache SW, bukan diteruskan ke jaringan.

### 2.3 Fix

```ts
// frontend/vite.config.ts
workbox: {
  navigateFallback: '/index.html',
  navigateFallbackDenylist: [/^\/api\//],  // ← baris baru
  ...
}
```

**Penting untuk user lama:** service worker lama masih aktif sampai ada satu reload penuh setelah deploy (mekanisme `autoUpdate` + `skipWaiting` + `clientsClaim` sudah aktif, jadi SW baru ambil alih otomatis di reload berikutnya — tidak perlu clear cache manual).

### 2.4 Alur Autentikasi Google OAuth (End-to-End, sudah benar setelah fix ini)

```
[Browser: mizanmu.pages.dev/login]
        │
        ▼ 1. Klik "Lanjutkan dengan Google"
[POST /api/auth/sign-in/social] ──(Cloudflare Proxy)──► [Hono Backend: onrender.com]
        │                                                          │
        │ ◄──────── 2. Set Cookie: __Secure-mizanmu.state ────────┘
        │ ◄────────    Redirect: accounts.google.com ─────────────┘
        ▼
[Google Consent & Account Chooser]
        │
        ▼ 3. Redirect ke callback URL (navigasi browser asli — ini yang tadinya ketelan SW)
[GET /api/auth/callback/google?code=...&state=...]
        │
   (Cloudflare Proxy dengan Cookie State)
        │
        ▼
[Better-Auth Handler (Render Backend)]
        │ ── Pertukaran code ke tokens via Google Token Endpoint
        │ ── Link Google Account ke user di tabel user (Neon DB)
        │ ── Set Cookie: __Secure-mizanmu.session_token
        ▼
[302 Redirect ke https://mizanmu.pages.dev/ (sukses) atau /login?error=... (gagal)]
        │
        ▼ 4. Inisialisasi Frontend Vue SPA
[GET /api/auth/get-session] ──► Validasi Sesi ──► Berhasil
[GET /api/v1/me] ───────────► Sinkronisasi Lembaga & Role ──► Masuk Dashboard!
```

### 2.5 Verifikasi yang sudah dilakukan

Navigasi ASLI (bukan fetch) ke `/api/auth/callback/google?state=<valid>&code=<sengaja salah>` melalui proxy production → mendarat bersih di `https://mizanmu.pages.dev/login?error=invalid_code` **dan** banner merah "Sesi login Google telah kedaluwarsa atau tidak valid" benar-benar tampil di UI. Ini membuktikan seluruh rantai (navigasi → Cloudflare Function → backend → validasi state via cookie → redirect error → tampil di LoginView) bekerja end-to-end.

**Belum bisa diverifikasi:** login Google dengan kode ASLI dari akun sungguhan (perlu kredensial user). Kalau `GOOGLE_CLIENT_SECRET` di Render salah, errornya sekarang akan **tampil jelas** di `/login` (bukan diam-diam gagal seperti sebelumnya).

---

## 3. PCA Ponjong — Onboarding & Import Data Historis

### Tenant

- Slug `pca-ponjong`, nama "PCA Ponjong", edisi `yayasan` (dibuat sebelum sesi ini, via UI Tenant Management).
- Edisi `yayasan` **tidak** dapat dana PSAK 109 (`fundSeedOptionsForEdition` return null) — relevan untuk bug "Dana wajib" di §1.

### Sumber data

Google Sheet buku kas: `https://docs.google.com/spreadsheets/d/16V89jk23vX42VzVTLa7t2lzU2kkopcb0bnI2GvWjKy0` — 75 baris transaksi nyata (26 Agustus 2023 – 10 Desember 2025), kolom No/TGL/Keterangan/Masuk/Keluar/Saldo. Baris 76–114 di sheet adalah baris kosong/carry-forward, sengaja dikecualikan. Sheet punya dua kolom "Saldo" yang saling beda mulai baris ke-7 (kolom pertama sepertinya rumus yang berhenti ter-update) — kolom Saldo terakhir dipakai sebagai acuan karena tervalidasi 100% cocok dengan perhitungan independen.

### Kategorisasi

| Kategori (`transaction_categories`) | Akun | Dipakai untuk |
|---|---|---|
| `PCA-INFAQ` — Infaq Anggota & Donatur | Kredit 4100 Infaq & Sedekah | Mayoritas baris Masuk (infaq anggota/kaleng/perorangan) |
| `PCA-PDPT-LAIN` — Penerimaan Lain-lain | Kredit 4900 Pendapatan Lain-lain | 4 baris non-infaq: Pengembalian konsumsi, Subsidi Rapat, Sisa uang konsumsi, Bagi hasil kaos |
| `PCA-BEBAN-PROGRAM` — Beban Program & Kegiatan | Debit 5200 Beban Program | Semua baris Keluar (transport, konsumsi, kontribusi kegiatan, dll) |
| *(tanpa kategori)* | Kredit 3900 Saldo Awal Aset Neto | Baris #1 "Dana dari Bendahara Lama" — diperlakukan sebagai saldo awal, bukan pendapatan operasional |

### Script

`backend/scripts/import-pca-ponjong-kas.ts` — dry-run by default, `--apply` untuk menulis. Idempoten via `referenceNo` unik per baris (`PCA-KAS-001` dst — baris yang sudah ada di-skip). Memakai jalur posting yang sama dengan `commitPAPImport` (posted langsung + jurnal + approval log dalam satu DB transaction).

```bash
cd backend
pnpm tsx scripts/import-pca-ponjong-kas.ts            # dry-run
pnpm tsx scripts/import-pca-ponjong-kas.ts --apply     # tulis ke DB
```

**Hasil**: 75 transaksi posted, 75 jurnal, saldo Kas akhir Rp4.312.000 — diverifikasi independen lewat SQL langsung (`SUM(debit) - SUM(credit)` dari `journal_lines`, bukan dari laporan script itu sendiri). Total semua jurnal tenant (debit − kredit) = Rp0, artinya setiap baris balance sempurna.

**Catatan penting**: setelah script seperti ini jalan (nulis langsung ke DB, bukan lewat API), **materialized view harus di-refresh manual** — lihat §1 baris "Dashboard nunjukkin Rp0".

### Data lanjutan (belum diimpor — in progress)

User punya foto tulisan tangan kelanjutan buku kas yang SAMA (saldo awal foto = Rp4.312.000, persis saldo akhir import di atas — nyambung tanpa celah). Karena ini tulisan tangan (bukan data digital bersih), **direkomendasikan diimpor lewat UI "Impor Rekapan Kas" sendiri** (bukan script manual lagi) — supaya ada langkah review manusia sebelum posting, mengingat OCR tulisan tangan lebih rawan salah baca. User sedang mencoba jalur ini; sempat terblokir oleh dua bug yang sudah diperbaiki di §1 (Dana wajib, tombol disabled tanpa penjelasan) dan oleh `ANTHROPIC_API_KEY` yang belum ter-set di Render — status akhir belum dikonfirmasi.

---

## 4. Konfigurasi Environment — Update

Tambahan dari checklist Render di §198 (masih berlaku semua): pastikan juga

| Variable | Status | Keterangan |
|---|---|---|
| `ANTHROPIC_API_KEY` | User sudah menambahkan manual di Render Dashboard sesi ini | **Belum dikonfirmasi berhasil** — minta user coba ulang Impor Rekapan Kas dan laporkan hasilnya. Kalau masih 503 `ocr_not_configured`, cek apakah Render benar-benar sudah redeploy setelah env var disimpan. |

---

## 5. Commit Terkait di `main` (hari ini, urut waktu)

Sesi sebelumnya (Google OAuth, belum menyelesaikan akar masalah):
- `113f39a` `fix(auth): enable google account linking, dynamic pages.dev origin, and sync user auth id`
- `cf7f0a7` `fix(ui): display error query parameter on login page`
- `c7ab4f6` `docs: update HANDOFF.md with detailed google oauth and session architecture`

Sesi ini:
- `fdd0ec0` `fix(auth): route Google OAuth errors to login page instead of better-auth's default page`
- `9ab5851` `fix(router): forward OAuth error query param through the login-required bounce`
- `fc466f5` `fix(pwa): exclude /api/* from service worker navigation fallback` — **root cause fix**
- `e93ca4a` `fix(pap-import): show live elapsed time during OCR + fix wrong timeout message`
- `f3386d2` `perf(pap-ocr): switch table extraction from Opus 4.8 to Sonnet 5`
- `ff7f1d0` `chore(scripts): add PCA Ponjong buku kas historical import`
- `4c45bc0` `fix(pap-import): don't require a fund on tenants that don't have any`
- `a629652` `fix(pap-import): explain why the read button stays disabled; document missing ANTHROPIC_API_KEY`
- `7245c49` `rename(pap-import): user-facing label PAP -> Rekapan Kas`

Semua commit sudah di-deploy sukses ke Cloudflare Pages (frontend) dan Render (backend, auto-deploy on push).

---

## 6. Follow-up yang direkomendasikan

1. **Konfirmasi `ANTHROPIC_API_KEY`**: minta user coba Impor Rekapan Kas lagi sekarang, pastikan tidak lagi 503.
2. **Import data lanjutan PCA Ponjong**: foto tulisan tangan (saldo awal Rp4.312.000) — tunggu user coba lewat UI, siap bantu baca hasil OCR kalau diminta.
3. **Cron "Refresh materialized views" (GH Actions) terus gagal** — belum diselidiki di sesi ini, cuma di-workaround dengan refresh manual sekali untuk PCA Ponjong. Kalau tidak diperbaiki, tenant/import baru lain berisiko kena gejala "dashboard Rp0" yang sama. Cek `.github/workflows/cron-refresh-mv.yml` dan `backend/src/lib/cron/refresh-mat-views.ts`.
4. **CI "Lint" terus gagal** (pre-existing, tidak terkait perubahan sesi ini) — `frontend` ESLint v9 butuh `eslint.config.js` (flat config), belum ada. Tidak menghalangi deploy (job terpisah dari "Deploy Cloudflare Pages"), tapi sebaiknya diperbaiki supaya CI hijau lagi.
5. **Verifikasi login Google dengan akun asli** — belum pernah dicoba end-to-end dengan kredensial sungguhan sejak root cause diperbaiki.
6. **Dokumentasi lama masih pakai nama "Impor Rekapan PAP"** (`README.md`, `docs/PAP_IMPORT.md`) — sengaja tidak diubah sesi ini (di luar scope permintaan user, hanya UI yang di-rename). Update kalau mau konsisten penuh.

---

## 7. Riwayat Handoff Sebelumnya (ringkas)

### 2026-08-25 (awal hari, sebelum sesi ini) — Transparansi Publik Dana PAP, Impor Rekapan PAP (awal), Dashboard Arus Kas

<details>
<summary>Detail (klik untuk buka)</summary>

#### Transparansi publik Dana PAP

Admin dengan izin `reports.publish` bisa memilih satu Dana PAP untuk dipublikasikan; jamaah membuka halaman read-only tanpa login untuk melihat ringkasan, mutasi anonim, dan PDF laporan periode yang dipilih.

Endpoint: `GET /api/v1/reports/public-pap` (status), `POST .../publish` (body `{fundId}`, perlu `reports.publish`), `POST .../revoke`. Data publik hanya nama/logo masjid, periode, saldo awal/akhir, penerimaan/penyaluran, dan mutasi anonim (tanpa nomor bukti/akun/donor/ID transaksi). Response `Cache-Control: no-store`.

File utama: `backend/src/db/migrations/sql/096_public_pap_reports.sql`, `backend/src/modules/accounting/public-pap/{service,route,export}.ts`, `frontend/src/features/public-pap/PublicPapView.vue`, `frontend/src/features/reports/ReportsView.vue`.

Commit: `c38b091`, `4a0d1c9`, `a757efb`, `3103d47`, `037ea2f`.

> Catatan domain: dokumentasi asli memakai `hisabmu.pages.dev` — domain produksi sekarang `mizanmu.pages.dev`/`mizanmu.id` (lihat §4 di atas), URL lama kemungkinan sudah tidak berlaku.

#### Impor Rekapan PAP (sekarang "Impor Rekapan Kas" — lihat §1)

Impor Excel atau 1–5 foto JPEG/PNG/WebP untuk satu dana. OCR (awalnya Claude Opus 4.8, sekarang Sonnet 5 — §1) hanya mentranskripsi; keputusan akun/dana dan posting tetap lewat review operator. Validasi MIME/signature/ukuran/fingerprint mencegah input salah/duplikat. Batch posting atomik + idempoten + audit trail.

File utama: `frontend/src/features/transactions/PapImportView.vue`, `backend/src/modules/accounting/transactions/{pap-import,pap-ocr,pap-commit}.ts`, `backend/src/db/migrations/sql/095_accounting_import_batches.sql`, `docs/PAP_IMPORT.md`.

Commit: `59c569b`, `bff6ff4`.

#### Dashboard arus kas & CoA

`DashboardView.vue` menampilkan arus kas 12 bulan lintas tahun (bulan terbaru auto-terpilih, hover untuk detail, keyboard + scroll horizontal). Commit: `619a7fc`. Picker akun induk (`ParentAccountSelect.vue`) menampilkan kode/nama/kedalaman hierarki sebagai absolute overlay.

#### Cara menjalankan lokal

```bash
# dari masjidmu-v2/
pnpm --filter @masjidmu/backend dev    # :3001
pnpm --filter @masjidmu/frontend dev   # :5173
pnpm --dir frontend typecheck
pnpm --dir frontend build
```

</details>

### 2026-07-01

Modul konten: event recurrence, perbaikan submit event/list duplikat, mass edit Program/Event/Berita/Pengumuman/Galeri, dan redesign form Event. Implementasinya masih ada; untuk detail historis gunakan git sebelum pembaruan handoff ini.
