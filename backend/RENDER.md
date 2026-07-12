# Render Config (free tier)

Backend di-deploy via Docker (image sama dengan yang dipakai Railway/lokal —
`Dockerfile` di root monorepo), bukan Nixpacks, supaya resolusi pnpm workspace
tetap benar tanpa perlu "Root Directory" trick.

Konfigurasi sudah dituliskan sebagai code di `render.yaml` (root repo) — Render
membacanya otomatis lewat alur **Blueprint**.

## Setup (one-time, via Render dashboard)

1. [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint**
2. Connect akun GitHub → pilih repo `masjidmu` (butuh login/otorisasi GitHub —
   lakukan sendiri, Render akan minta akses read ke repo)
3. Render mendeteksi `render.yaml` → preview service `masjidmu-backend`
   (Docker, plan Free, region Singapore) → **Apply**
4. Isi env var yang ditandai "sync: false" di layar berikutnya (lihat tabel di
   bawah) — `BETTER_AUTH_SECRET` dan `JOBS_INTERNAL_TOKEN` sudah di-generate
   otomatis oleh Render, tidak perlu diisi.

## Env vars yang wajib diisi manual

| Key | Dari mana |
|-----|-----------|
| `DATABASE_URL` | [console.neon.tech](https://console.neon.tech) → Project → Connection string |
| `BETTER_AUTH_URL` | `https://app.hisabmu.id` (origin frontend, same-origin proxy) |
| `UPSTASH_REDIS_URL` / `UPSTASH_REDIS_TOKEN` | [console.upstash.com](https://console.upstash.com) |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY` / `R2_SECRET_KEY` | Cloudflare dashboard → R2 → API tokens |
| `RESEND_API_KEY` | [resend.com/api-keys](https://resend.com/api-keys) |
| `SENTRY_DSN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Opsional — kosongkan kalau belum dipakai |

## Batasan free tier (penting)

- Service **tidur setelah ~15 menit tanpa request**. Request pertama setelah
  tidur kena cold-start ~30–50 detik (build image + boot Node) sebelum
  respons pertama datang. Cocok untuk app internal DKM yang tidak diakses
  24/7 — kalau butuh selalu-aktif, upgrade ke plan berbayar termurah
  (~$7/bulan) menghilangkan sleep ini.
- 750 jam compute gratis/bulan (lebih dari cukup untuk satu service yang idle
  sebagian besar waktu).
- Cron job internal (`refresh-mat-views`, dsb.) yang jalan di dalam proses
  Node tidak akan tereksekusi saat service sedang tidur — kalau butuh jadwal
  pasti, pakai [Render Cron Jobs](https://render.com/docs/cronjobs) terpisah
  (paid) atau GitHub Actions `workflow_dispatch` on schedule yang cuma
  membangunkan lewat HTTP hit ke endpoint terkait.

## Custom domain

Render → Service → **Settings** → **Custom Domains** → tambah `api.hisabmu.id`
→ Render kasih target CNAME → tambahkan di Cloudflare DNS (proxy status:
**DNS only**, bukan proxied, supaya TLS Render yang menangani).

## Health check

Sudah otomatis lewat `healthCheckPath: /healthz` di `render.yaml` — Render
memantau endpoint ini untuk restart otomatis kalau proses crash.

## Auto-deploy

Push ke branch `main` (path `backend/**` atau `Dockerfile` berubah) memicu
build ulang otomatis — tidak perlu workflow GitHub Actions terpisah seperti
Cloudflare Pages, Render sudah built-in watch dari koneksi GitHub-nya.
