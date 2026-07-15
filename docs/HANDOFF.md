# Handoff — MasjidMu v2

**Tanggal:** 2026-07-15
**Branch aktif:** `feat/pap-import` (sudah pushed ke `origin/feat/pap-import`)
**Tenant uji publik:** `lazismu-ponjong`
**Stack:** Vue 3 + Vite/Cloudflare Pages (frontend), Hono + Drizzle + Neon/Render (backend)

---

## Status sesi terakhir

| Area | Status |
|---|---|
| Impor Rekapan PAP dari Excel/foto | Selesai dan deployed |
| OCR foto PAP: clipboard, validasi, rotasi, progres | Selesai |
| Dashboard arus kas rolling 12 bulan | Selesai dan deployed |
| CoA: picker akun induk dan layout modal | Selesai |
| Transparansi publik Dana PAP | Selesai, published, dan diuji di production |
| Dokumentasi/import changelog | Diperbarui di sesi ini |

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
