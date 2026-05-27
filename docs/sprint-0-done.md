# Sprint 0 — Done

**Date completed:** 2026-05-27
**Spent:** 1 day (target was 5 days — AI-assisted velocity)
**Status:** Foundation ready, dry-verified locally

## What was built

- Monorepo (`pnpm` workspaces): `backend/`, `frontend/` (placeholder), `shared/`
- Hono backend: `/healthz`, `/`, `/_test-error` (dev-only)
- Drizzle ORM + initial `tenants` schema + migration runner
- `withTenant()` + `asSuperAdmin()` RLS-aware DB helpers
- Pino structured logging
- Sentry integration (no-op when `SENTRY_DSN` unset)
- Telegram alert helper (fire-and-forget, fail-soft)
- ESLint + Vitest + 5 passing tests
- GitHub Actions: CI (typecheck/lint/test) + 3 cron workflows
- Dockerfile (Railway/portable)
- Cloudflare DNS doc, Railway setup doc

## Local verification

| Check | Result |
|---|---|
| `pnpm install` | 288 packages, no errors |
| `pnpm typecheck` | green |
| `pnpm lint` | green |
| `pnpm test` | 5/5 |
| `pnpm db:generate` | generates valid SQL |
| `pnpm dev` + `curl /healthz` | 200 OK |

## NOT verified (requires production secrets)

- ❌ Real Neon DB connection
- ❌ Real Sentry alerts
- ❌ Real Telegram bot send
- ❌ GitHub Actions CI run (needs repo + secrets)
- ❌ Railway deploy (needs account)
- ❌ Cloudflare DNS resolution
- ❌ End-to-end `https://api.masjidmu.id/healthz`

These wait for pre-flight checklist completion.

## Pre-flight (owner)

See list in `README.md` and the implementation plan. 10 items, ~2-3 hours of
account setup. After all set, Day 5 verification: push to GitHub, watch CI,
verify deploy, hit prod healthz, trigger `/_test-error` once, confirm Telegram
gets the alert.

## Next: Sprint 1 — Schema & RLS

Goal: 43 tables defined in Drizzle, RLS policies live, cross-tenant test green,
super_admin bypass works. Plan in
`docs/superpowers/plans/2026-05-27-sprint-0-1-implementation.md` (Day 6-10).

Hard gates before Sprint 2:
- Schema parity with DATABASE_v2 (43 tables, FKs correct)
- 5 critical RLS isolation tests green
- Journal balance trigger rejects unbalanced inserts
- `account_type` enum is English values
- Default deny without context (empty result)
- CI green on Neon test branch
- pg_partman availability known (or fallback ready)
