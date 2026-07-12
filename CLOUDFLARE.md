# Cloudflare — DNS + Pages deploy (HisabMu)

## Arsitektur

```
Browser
  │
  ├─ https://app.hisabmu.id          → Cloudflare Pages (Vue SPA + Functions)
  │       /api/*  ──proxy──►  API_ORIGIN (Render Node Hono)
  │       /*      ──SPA───►  index.html
  │
  └─ (opsional) https://api.hisabmu.id  → backend langsung (DNS only / health)
```

Same-origin `/api` via Pages Function = cookie better-auth ikut domain app.

Backend API **tidak** di-host di Workers free (butuh Node long-running + Docker).  
Deploy API terpisah — lihat [`backend/RENDER.md`](backend/RENDER.md) (free tier, dipakai sekarang) — lalu set `API_ORIGIN` di Pages.

---

## Deploy frontend (Cloudflare Pages)

### Sekali saja — prasyarat

1. Akun [Cloudflare](https://dash.cloudflare.com) (free OK).
2. Install CLI & login:

```bash
cd masjidmu-v2
pnpm add -D wrangler --filter @masjidmu/frontend
npx wrangler login
```

3. Buat API Token: **My Profile → API Tokens → Create**  
   Template **Edit Cloudflare Workers** (cukup untuk Pages deploy), atau custom:
   - Account → Cloudflare Pages → Edit  
   - Account → Account Settings → Read  

### Deploy manual (lokal)

```bash
cd masjidmu-v2
pnpm deploy:cf
# = build frontend + wrangler pages deploy dist --project-name=hisabmu
```

Preview branch:

```bash
pnpm deploy:cf:preview
```

### Env wajib di Pages project

Dashboard → **Workers & Pages** → **hisabmu** → **Settings** → **Variables and Secrets**:

| Name | Value | Environment |
|------|--------|-------------|
| `API_ORIGIN` | `https://masjidmu-backend.onrender.com` (tanpa `/` akhir) | Production (+ Preview jika perlu) |

Tanpa `API_ORIGIN`, UI tetap load; request `/api/*` → JSON `503 api_origin_missing`.

### Custom domain

Pages → **hisabmu** → **Custom domains** → `app.hisabmu.id` (atau `masjidmu.id`).  
DNS di zone Cloudflare: CNAME ke `hisabmu.pages.dev` (otomatis jika domain di akun yang sama).

---

## DNS production (referensi)

| Type  | Name | Target | Proxy |
|-------|------|--------|--------|
| CNAME | `app` / `@` | `hisabmu.pages.dev` | Proxied |
| CNAME | `api` | `<service>.onrender.com` | DNS only (recommended) |

SSL/TLS zone: **Full (strict)**.

---

## CI (GitHub Actions)

Workflow: `.github/workflows/deploy-cloudflare-pages.yml`  
Push ke `main`/`master` (path `frontend/**`) → build + deploy.

Secrets repo:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

---

## Backend (bukan di Pages)

Render (free tier), config-as-code di `render.yaml` (root repo) — detail
lengkap & batasan free tier di [`backend/RENDER.md`](backend/RENDER.md).

```bash
# ENV penting:
#   DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL
#   BETTER_AUTH_URL = https://app.hisabmu.id   (origin FE, same-origin proxy)
```

CORS backend mengizinkan: localhost, `*.hisabmu.id`, `*.masjidmu.id`, `*.pages.dev`.  
Dengan proxy same-origin, browser jarang butuh CORS ke API langsung.

---

## Verifikasi

```bash
# Static
curl -I https://hisabmu.pages.dev/
# expect 200

# Proxy (setelah API_ORIGIN + backend hidup)
curl -s https://hisabmu.pages.dev/api/v1/healthz
# atau path health yang ada di backend
```

Login di browser → cookie ter-set di domain Pages.

---

## File terkait

| Path | Peran |
|------|--------|
| `frontend/wrangler.toml` | Nama project Pages |
| `frontend/functions/api/[[path]].ts` | Proxy `/api/*` |
| `frontend/public/_redirects` | SPA fallback |
| `.github/workflows/deploy-cloudflare-pages.yml` | CI deploy |
| `Dockerfile` | Image backend (Render) |
| `render.yaml` | Blueprint config-as-code untuk Render |
| `backend/RENDER.md` | Panduan setup Render + batasan free tier |
