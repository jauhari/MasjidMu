# MasjidMu v2

Backend rewrite — Hono + Drizzle + Neon Postgres. Frontend Vue 3 (existing) di-rewire.

## Spec & Plan

- Spec: `../docs/superpowers/specs/2026-05-27-backend-rewrite-design.md`
- Plan: `../docs/superpowers/plans/2026-05-27-sprint-0-1-implementation.md`

## Setup local

```bash
pnpm install
cp backend/.env.example backend/.env.local
# Fill backend/.env.local dengan credentials Neon, Upstash, R2, Resend, dll
pnpm dev
# → http://localhost:3000/healthz
```

## Stack

- **Runtime**: Node 20 + TypeScript
- **Backend**: Hono + Drizzle + better-auth
- **DB**: Neon Postgres (RLS multi-tenant)
- **Cache**: Upstash Redis
- **Storage**: Cloudflare R2
- **Hosting**: Railway (BE) + Cloudflare Pages (FE)

## Workspace

```
masjidmu-v2/
├── backend/    # Hono + Drizzle (in development)
├── frontend/   # Vue 3 (akan di-rewire dari masjidmu/frontend)
└── shared/     # TS types & Zod schemas (FE+BE)
```
