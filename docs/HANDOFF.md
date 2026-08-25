# Handoff — MasjidMu v2 / MizanMu

**Tanggal:** 2026-08-25  
**Branch aktif:** `main` (sudah dipush ke `origin/main`)  
**Domain Produksi:** Frontend `https://mizanmu.pages.dev`, Backend `https://masjidmu-backend.onrender.com`  
**Stack:** Vue 3 + Vite + Reka UI + Cloudflare Pages (frontend), Hono + Better-Auth + Drizzle + Neon PostgreSQL / Render (backend)

---

## 1. Ringkasan Sesi Terakhir (Google OAuth & Auth System Fix)

Pada sesi ini diselesaikan perbaikan menyeluruh pada alur autentikasi **Login dengan Google** (*social sign-in*), integrasi multi-tenant profil user, serta perbaikan proxy Cloudflare Pages Functions.

| Area | Masalah Sebelumnya | Solusi / Status |
|---|---|---|
| **Better-Auth Account Linking** | Error saat user login Google jika emailnya sudah pernah terdaftar dengan kata sandi (*credential*). | Mengaktifkan `account: { accountLinking: { enabled: true, trustedProviders: ['google'] } }` di Better-Auth. |
| **Koneksi Database SSL (Neon)** | `pg.Pool` hanya mengaktifkan SSL jika `NODE_ENV === 'production'`. Di local dev, koneksi ke Neon timeout/hang. | Mengaktifkan SSL otomatis jika `DATABASE_URL` mengandung `sslmode=require` atau `neon.tech`. |
| **Origin & Cookie Mismatch** | `BETTER_AUTH_URL` di `.env.local` sebelumnya mengarah ke `:3001` (backend), sehingga cookie tidak terbawa ke frontend `:5173`. | Mengarahkan `BETTER_AUTH_URL` ke origin frontend (`http://localhost:5173` di dev, `https://mizanmu.pages.dev` di prod). |
| **Cloudflare Pages Proxy** | Proxy `functions/api/[[path]].ts` sebelumnya meng-hardcode origin ke domain lama `https://hisabmu.pages.dev` dan berpotensi memotong multi-cookie `Set-Cookie`. | Menghapus override origin lama dan menambahkan pelestarian multi-cookie menggunakan `getSetCookie()`. |
| **Multi-Tenant User Sync** | ID user Google (`auth.user.id`) tidak otomatis terhubung ke tabel `users` per lembaga/tenant di Neon DB. | Menambahkan fungsi `syncUserAuthId` dan pencarian user by `(authUserId OR email)` pada `ensureUserMapping`. |
| **Feedback Error Login UI** | Tidak ada penanganan parameter query `?error=...` di halaman login saat Google OAuth gagal. | Menambahkan `onMounted` di `LoginView.vue` untuk mendeteksi `route.query.error` dan menampilkan pesan ramah. |

---

## 2. Rincian Teknis & Arsitektur Auth

### 2.1 Alur Autentikasi Google OAuth (End-to-End)

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
        ▼ 3. Redirect ke callback URL
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
[302 Redirect ke https://mizanmu.pages.dev/]
        │
        ▼ 4. Inisialisasi Frontend Vue SPA
[GET /api/auth/get-session] ──► Validasi Sesi ──► Berhasil
[GET /api/v1/me] ───────────► Sinkronisasi Lembaga & Role ──► Masuk Dashboard!
```

---

## 3. Implementasi & Perubahan File

### Backend

1. **`backend/src/db/client.ts`**
   - Mengaktifkan SSL pada `pg.Pool` secara dinamis:
     ```ts
     ssl:
       env.NODE_ENV === 'production' ||
       env.DATABASE_URL.includes('sslmode=require') ||
       env.DATABASE_URL.includes('neon.tech')
         ? { rejectUnauthorized: false }
         : false,
     ```

2. **`backend/src/lib/auth.ts`**
   - Menambahkan opsi `accountLinking`:
     ```ts
     account: {
       accountLinking: {
         enabled: true,
         trustedProviders: ['google'],
       },
     },
     ```
   - Memperluas `trustedOrigins` dengan wildcard domain (`*.mizanmu.id`, `*.pages.dev`, `*.pcmponjong.id`, `*.hisabmu.id`, `*.masjidmu.id`, `https://masjidmu-backend.onrender.com`).

3. **`backend/src/lib/user-mapping.ts`**
   - Menambahkan `syncUserAuthId(auth: AuthUserSnapshot)`: Memperbarui `authUserId` pada tabel `users` untuk email yang cocok secara otomatis.
   - Memperbarui `ensureUserMapping`: Mencocokkan user berdasarkan `(authUserId OR email)` dalam tenant untuk mencegah konflik constraint `unique(tenant_id, email)`.

4. **`backend/src/middleware/session.ts`**
   - Memanggil `syncUserAuthId` saat session berhasil divalidasi dengan cache in-memory (TTL 5 menit) untuk meminimalkan beban database.

### Frontend

1. **`frontend/functions/api/[[path]].ts`** (Cloudflare Pages Function)
   - Menghapus baris legacy yang memaksa `headers.set('origin', 'https://hisabmu.pages.dev')`.
   - Menambahkan pelestarian raw `Set-Cookie` headers:
     ```ts
     if (typeof upstream.headers.getSetCookie === 'function') {
       const cookies = upstream.headers.getSetCookie();
       if (cookies.length > 0) {
         outHeaders.delete('set-cookie');
         for (const cookie of cookies) {
           outHeaders.append('set-cookie', cookie);
         }
       }
     }
     ```

2. **`frontend/src/features/auth/LoginView.vue`**
   - Menambahkan penanganan `route.query.error` pada `onMounted` agar error OAuth (seperti akun kadaluwarsa atau penolakan provider) langsung terlihat di layar.

3. **`backend/.env.local`**
   - Memperbarui `BETTER_AUTH_URL=http://localhost:5173` agar alur callback dev lokal berjalan pada origin frontend.

---

## 4. Konfigurasi Environment & Production Checklist

### A. Render (Backend `masjidmu-backend`)

Pada **Render Dashboard** → **Environment Variables**:

| Variable | Nilai yang Benar | Keterangan |
|---|---|---|
| `NODE_ENV` | `production` | Mode production |
| `PORT` | `3000` | Port listen di dalam container Docker |
| `DATABASE_URL` | `postgresql://masjidmu_app:...@...neon.tech/neondb?sslmode=require` | App role NOBYPASSRLS |
| `BETTER_AUTH_URL` | `https://mizanmu.pages.dev` | **Wajib origin frontend publik** |
| `BETTER_AUTH_SECRET` | *(string random 32+ char)* | Kunci enkripsi sesi |
| `GOOGLE_CLIENT_ID` | `5420986...apps.googleusercontent.com` | OAuth Client ID Google |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-...` | OAuth Client Secret Google |
| `PUBLIC_TENANT_PROXY_SECRET`| *(string secret)* | HMAC signature untuk tenant proxy |

### B. Cloudflare Pages (Project `mizanmu`)

Pada **Cloudflare Dashboard** → **Workers & Pages** → Project `mizanmu` → **Settings** → **Environment variables**:

| Variable | Nilai | Keterangan |
|---|---|---|
| `API_ORIGIN` | `https://masjidmu-backend.onrender.com` | Target proxy `/api/*` ke Render |
| `PUBLIC_TENANT_PROXY_SECRET` | *(string secret yang sama dengan Render)* | Untuk verifikasi subdomain proxy |

### C. Google Cloud Console (OAuth 2.0 Client ID)

Pada [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

* **Authorized JavaScript origins:**
  - `http://localhost:5173`
  - `http://localhost:3001`
  - `https://mizanmu.pages.dev`
  - `https://mizanmu.id`
* **Authorized redirect URIs:**
  - `http://localhost:5173/api/auth/callback/google`
  - `http://localhost:3001/api/auth/callback/google`
  - `https://mizanmu.pages.dev/api/auth/callback/google`
  - `https://mizanmu.id/api/auth/callback/google`
  - `https://masjidmu-backend.onrender.com/api/auth/callback/google`

---

## 5. Perintah Validasi & Operasional

```bash
# Masuk ke direktori monorepo
cd "masjidmu-v2"

# 1. Typecheck Frontend & Backend
pnpm --filter @masjidmu/backend typecheck
pnpm --filter @masjidmu/frontend typecheck

# 2. Menjalankan Seluruh Unit Test Backend
pnpm --filter @masjidmu/backend test

# 3. Build & Deploy Frontend ke Cloudflare Pages
pnpm --filter @masjidmu/frontend build
pnpm --filter @masjidmu/frontend deploy:cf

# 4. Menjalankan Server Lokal
pnpm --filter @masjidmu/backend dev   # Port 3001
pnpm --filter @masjidmu/frontend dev  # Port 5173
```

---

## 6. Commit Terkait di `main`

- `113f39a` `fix(auth): enable google account linking, dynamic pages.dev origin, and sync user auth id`
- `cf7f0a7` `fix(ui): display error query parameter on login page`

---

## 1. Transparansi publik Dana PAP

### Tujuan

Admin yang memiliki izin `reports.publish` dapat memilih satu Dana PAP untuk dipublikasikan. Jamaah membuka halaman read-only tanpa login untuk melihat ringkasan, mutasi anonim, dan PDF laporan periode yang dipilih.

### Alur admin

1. Masuk ke **Laporan Keuangan**.
2. Pada kartu **Transparansi Dana PAP**, pilih dana.
3. Klik **Publikasikan** dan konfirmasi.
4. Salin atau buka tautan publik yang ditampilkan.
5. Gunakan **Cabut** untuk membuat laporan tidak lagi tersedia bagi publik.

Endpoint terlindungi:

- `GET /api/v1/reports/public-pap` — status publikasi aktif.
- `POST /api/v1/reports/public-pap/publish` — memerlukan `reports.publish`, body `{ fundId }`.
- `POST /api/v1/reports/public-pap/revoke` — memerlukan `reports.publish`.

### Halaman dan API publik

- URL production/temporary Pages:
  `https://hisabmu.pages.dev/transparansi/{tenantSlug}/pap`
- Contoh tenant uji:
  `https://hisabmu.pages.dev/transparansi/lazismu-ponjong/pap`
- API publik:
  `GET /api/public/pap?tenant_slug={tenantSlug}&month=7&year=2026`
- PDF publik:
  tambahkan `format=pdf` pada API di atas.

Route Vue yang tersedia:

- `/transparansi/pap` — untuk domain tenant ketika subdomain produksi telah dipakai.
- `/transparansi/:tenantSlug/pap` — dipakai oleh temporary shared Pages URL.

### Privasi dan perilaku

Data publik hanya memuat:

- nama/logo/banner masjid;
- periode dan waktu publikasi;
- saldo awal/akhir, penerimaan, penyaluran, surplus/defisit;
- tanggal, arah, label anonim, nominal, dan saldo berjalan tiap mutasi.

Data internal tidak dikirim: nomor bukti, akun, donor/penerima, catatan internal, ID transaksi, dan kredensial. Respons publik memakai `Cache-Control: no-store`.

Jika belum ada publikasi aktif, endpoint mengembalikan `404 public_report_unavailable` dan UI menampilkan keadaan laporan belum tersedia.

### Implementasi utama

| Path | Peran |
|---|---|
| `backend/src/db/migrations/sql/096_public_pap_reports.sql` | Tabel publikasi satu dana aktif per tenant + RLS/perizinan. |
| `backend/src/db/schema/accounting.ts` | Definisi Drizzle `publicPapReports`. |
| `backend/src/modules/accounting/public-pap/service.ts` | Status, publish/revoke, dan pembentukan data publik yang sudah difilter. |
| `backend/src/modules/accounting/public-pap/route.ts` | `GET /api/public/pap`, rate limit, validasi periode, JSON/PDF. |
| `backend/src/modules/accounting/public-pap/export.ts` | Render PDF publik. |
| `backend/src/modules/accounting/reports/route.ts` | Endpoint admin publish/revoke/status. |
| `frontend/src/features/reports/ReportsView.vue` | Kontrol publish/revoke, salin, dan buka URL publik. |
| `frontend/src/features/public-pap/PublicPapView.vue` | Halaman publik read-only, picker periode, ringkasan, mutasi, PDF. |
| `frontend/src/router/index.ts` | Route publik slugged dan non-slugged. |
| `frontend/functions/api/[[path]].ts` | Proxy Pages meneruskan konteks tenant untuk route publik. |

### Commit terkait

- `c38b091 feat(public): publish PAP transparency report`
- `4a0d1c9 fix(public): preserve tenant context for protected proxy calls`
- `a757efb fix(public): default PAP report period correctly`
- `3103d47 fix(public): support slugged PAP transparency URLs`
- `037ea2f fix(public): generate PAP pages dev share URL`

### Deployment dan verifikasi

- Migration `096_public_pap_reports.sql` sudah diterapkan ke production DB dan permission sudah diberikan.
- Backend production sudah memuat route publik.
- Cloudflare Pages production terakhir dideploy manual dari source branch ini ke:
  `https://edc958e2.hisabmu.pages.dev`
- Alias `https://hisabmu.pages.dev` sudah memuat bundle tersebut.
- `https://hisabmu.pages.dev/api/public/pap?tenant_slug=lazismu-ponjong&month=7&year=2026` mengembalikan `reportType: "pap-transparency"`.
- URL halaman publik dapat diakses.

> Penting: branch git yang memuat perubahan adalah `feat/pap-import`, bukan `main`; deploy Pages dilakukan manual dengan `pnpm deploy:cf`, yang menggunakan `--branch=main`. Saat merge ke `main`, pastikan tidak ada konflik dan biarkan CI/deploy merepresentasikan commit main.

---

## 2. Impor Rekapan PAP

### Kapabilitas

- Impor Excel atau 1–5 foto JPEG/PNG/WebP untuk satu dana PAP.
- Foto dapat dipaste dengan `Ctrl+V`.
- OCR hanya mentranskripsikan data; keputusan akun/dana dan posting tetap melalui review operator.
- EXIF orientation dinormalisasi server-side; operator dapat merotasi masing-masing gambar 90° sebelum OCR.
- Validasi MIME, signature/byte, ukuran, jumlah foto, dan fingerprint batch mencegah input salah/duplikat.
- Progress UI membedakan proses unggah dan OCR.
- Batch diposting atomik, idempoten, memiliki metadata audit, dan penomoran transaksi/jurnal aman di bawah concurrent input.
- Seluruh journal line membawa tag dana untuk PSAK 109.

### File penting

- `frontend/src/features/transactions/PapImportView.vue`
- `backend/src/modules/accounting/transactions/pap-import.ts`
- `backend/src/modules/accounting/transactions/pap-ocr.ts`
- `backend/src/modules/accounting/transactions/pap-commit.ts`
- `backend/src/modules/accounting/transactions/route.ts`
- `backend/src/db/migrations/sql/095_accounting_import_batches.sql`
- `docs/PAP_IMPORT.md`

### Commit

- `59c569b feat(accounting): add reviewed PAP import`
- `bff6ff4 feat(pap): improve image import reliability and feedback`

### Catatan operasional OCR

OCR memakai Anthropic Vision. Gangguan sebelumnya berasal dari API key/gateway override yang tidak valid; endpoint resmi telah dipaksa dan key diganti. Jika OCR gagal lagi, cek environment `ANTHROPIC_API_KEY`, gateway/base URL override, dan log request ID backend sebelum mengubah UI.

---

## 3. Dashboard dan CoA

### Dashboard arus kas

`frontend/src/features/dashboard/DashboardView.vue` kini menampilkan arus kas 12 bulan lintas tahun:

- bulan terbaru otomatis terpilih;
- nilai pemasukan, pengeluaran, dan surplus/defisit tampil saat hover;
- tiap bulan dapat dipilih untuk membuka detail;
- chart mendukung keyboard dan horizontal scrolling pada layar kecil;
- laporan ringkas mengikuti periode aktif.

Commit: `619a7fc feat(dashboard): add rolling cash flow overview`.

### Chart of Accounts

Picker akun induk menampilkan kode, nama, dan kedalaman hierarki. Dropdown dibuat sebagai absolute overlay agar daftar tidak memperpanjang modal.

File utama:

- `frontend/src/shared/ui/AppSelect.vue`
- `frontend/src/shared/ui/ParentAccountSelect.vue`
- `frontend/src/features/accounts/AccountsView.vue`

---

## 4. Verifikasi yang sudah dilakukan

```bash
# Frontend
pnpm --dir frontend typecheck
pnpm --dir frontend build

# Deploy frontend production Pages
pnpm deploy:cf
```

Hasil sesi terakhir:

- frontend `typecheck` passed;
- frontend production build passed;
- Cloudflare Pages deployment passed;
- endpoint PAP publik production mengembalikan report JSON valid;
- worktree bersih setelah commit `037ea2f`.

Peringatan build non-blocking dari Rollup pada dependency `@vueuse/core` terkait posisi komentar `/* #__PURE__ */`; build tetap sukses.

Validasi backend terdahulu: OCR test 8/8, backend typecheck/lint/build, dan 79 backend tests passed. Satu timeout `/healthz` pernah pre-existing dan tidak terkait PAP.

---

## 5. Cara menjalankan lokal

```bash
# dari masjidmu-v2/
pnpm --filter @masjidmu/backend dev    # :3001
pnpm --filter @masjidmu/frontend dev   # :5173

# validasi frontend
pnpm --dir frontend typecheck
pnpm --dir frontend build
```

Frontend publik lokal dapat dibuka melalui:

```text
http://localhost:5173/transparansi/lazismu-ponjong/pap
```

Pastikan frontend memiliki tenant slug yang tepat atau gunakan route slugged di atas agar query `tenant_slug` diteruskan ke public API.

---

## 6. Follow-up yang direkomendasikan

1. **Merge branch:** buat/selesaikan PR `feat/pap-import` ke `main`; deploy saat ini sudah manual tetapi history source of truth tetap perlu masuk main.
2. **Uji browser manual sebagai admin:** publish dana lain, salin URL, buka incognito, cek PDF, lalu cabut dan pastikan URL mengembalikan keadaan unavailable.
3. **Domain produksi:** saat wildcard/custom tenant subdomain `*.hisabmu.id` benar-benar aktif, gunakan URL tenant asli `https://{slug}.hisabmu.id/transparansi/pap`; route non-slugged sudah disiapkan.
4. **Observability:** pantau Render logs untuk public API/PDF dan Cloudflare Pages Functions bila request publik gagal.
5. **PAP importer:** lanjutkan uji dengan rekapan produksi yang sudah dianonimkan dan cocokkan saldo sumber sebelum posting.

---

## 7. Riwayat handoff sebelumnya

Handoff 2026-07-01 mencakup modul konten: event recurrence, perbaikan submit event/list duplikat, mass edit Program/Event/Berita/Pengumuman/Galeri, dan redesign form Event. Implementasinya masih ada; untuk detail historis gunakan git sebelum pembaruan handoff ini.
