> **Tidak dipakai saat ini** — backend di-host di Render (free tier), lihat
> [`RENDER.md`](./RENDER.md). Railway tidak punya tier gratis lagi (minimal
> Hobby plan ~$5/bulan + kartu kredit). Dokumen ini dibiarkan sebagai
> referensi kalau suatu saat pindah ke Railway.

# Railway Config

Railway picks up the backend service from this directory automatically when
you set the project root to `backend/`. No `railway.toml` is required for the
basic case, but pinning a config keeps deploys deterministic.

## Setup (one-time, via Railway dashboard)

1. **New Project** → Deploy from GitHub → select repo `masjidmu`
2. **Root Directory**: `backend`
3. **Build Command**: `pnpm install --frozen-lockfile && pnpm build`
4. **Start Command**: `pnpm start`
5. **Watch Paths**: `backend/**` (auto-deploy only when backend changes)

## Connect Neon

Railway → Service → Settings → Connect → Neon Postgres → choose `main` branch.
Railway auto-injects `DATABASE_URL` into the service environment.

## Env vars (production)

Copy from `backend/.env.example` and fill production values:

```
NODE_ENV=production
PORT=3000
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://api.masjidmu.id
UPSTASH_REDIS_URL=...
UPSTASH_REDIS_TOKEN=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_BUCKET=masjidmu-media
RESEND_API_KEY=re_...
SENTRY_DSN=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
JOBS_INTERNAL_TOKEN=<openssl rand -base64 32>
```

## Custom domain

Railway → Service → Settings → Networking → Custom Domain
- Enter: `api.masjidmu.id`
- Railway returns a CNAME target (e.g. `xxx.up.railway.app`)
- Add CNAME at Cloudflare DNS → `api.masjidmu.id` → that target

## Health check

Railway → Service → Settings → Healthcheck Path: `/healthz`
