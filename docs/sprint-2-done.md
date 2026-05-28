# Sprint 2 — Done

**Date completed:** 2026-05-28 (single session, target was 5 days)
**Status:** All hard gates passed. Auth + tenant + permissions work end-to-end.

## What was built

### better-auth integration
- `auth.user` (text id, email/password identity)
- `auth.account` (hashed credentials per provider)
- `auth.session` (active logins, 7d expiry, 5min cookie cache)
- `auth.verification` (email/reset tokens)
- `auth.organization` / `member` / `invitation` (multi-tenant primitive)
- Routes mounted at `/api/auth/*` via `auth.handler`
- Per-subdomain cookie scope (no cross-tenant leak)
- Trusted origins whitelisted (localhost + masjidmu.id subdomains)

### App-side identity sync
- `users` table refactored: `authUserId` (text) maps to `auth.user.id`
- `ensureUserMapping()` — idempotent sync on sign-in
- `findTenantUser()` — lookup helper
- One auth user can map to multiple tenants

### Middleware stack
- `sessionResolver` — reads better-auth cookie, exposes `c.var.user/session`
- `tenantResolver` — subdomain → tenant_id, in-memory cache 60s, dev `X-Tenant-Slug` header
- `permissionResolver` — loads roles → permissions, Upstash 5min cache, super_admin bypass
- `rateLimit('login'|'api'|'export')` — Upstash sliding window
- `auditInterceptor` — async write to `audit_logs` (fire-and-forget)
- Guards: `requireSession`, `requireTenant`, `requirePermission(code)`

### Endpoints (live tested)
- `GET /api/v1/tenants` — list (super_admin)
- `POST /api/v1/tenants` — create (slug validation, 409 on duplicate)
- `GET /api/v1/tenants/:id` — detail
- `PATCH /api/v1/tenants/:id` — update
- `GET /api/v1/users` — list (RLS-scoped to tenant)
- `GET /api/v1/users/:id` — detail (RLS-scoped)
- `PATCH /api/v1/users/:id` — update name/status (RLS-scoped)

### Bootstrap script
- `scripts/bootstrap.ts` — create first tenant + first super_admin
- Used to provision: `admin` tenant + `admin@masjidmu.id` user with `super_admin` role

### Acceptance gates (all passed)
1. ✅ better-auth tables present (7)
2. ✅ Bootstrap super_admin exists
3. ✅ auth.user ↔ users mapping populated
4. ✅ Upstash Redis reachable
5. ✅ better-auth API surface (getSession, signUpEmail, signInEmail)
6. ✅ Middleware modules load
7. ✅ App boots, /healthz returns 200
8. ✅ /api/v1/* requires session (401 without)

## Live E2E verification

```bash
# 1. Sign in (returns token + sets cookie)
curl -X POST /api/auth/sign-in/email \
  -d '{"email":"admin@masjidmu.id","password":"…"}'
→ 200 { "token": "...", "user": {...} }

# 2. List tenants (uses session cookie)
curl -b cookies.txt /api/v1/tenants
→ 200 { "data": [{ "slug": "admin", ... }] }

# 3. List users (with X-Tenant-Slug header for dev)
curl -b cookies.txt -H "X-Tenant-Slug: admin" /api/v1/users
→ 200 { "data": [{ "email": "admin@masjidmu.id", ... }] }

# 4. Without session
curl /api/v1/tenants
→ 401 { "error": "unauthenticated" }
```

## Decisions / surprises

- **Schema mapping over forced mapping**: tried "map app tables → better-auth"
  but reverted to "tables terpisah dgn sync" — multi-tenant constraints in
  `users` (per-tenant unique email) don't fit better-auth's global-unique
  assumption. Sync via `ensureUserMapping()` is the right boundary.
- **Sessions table dropped**: better-auth manages session in its own table.
  No app-side mirror needed.
- **Roles allow tenant_id IS NULL**: needed for system roles
  (`super_admin`); RLS policy `012_rls_roles_allow_null_tenant.sql` allows
  reads of NULL-tenant rows from any tenant context.
- **Upstash sliding window**: good DX, free tier ample for MVP scale.
- **Audit writes synchronously for MVP**: BullMQ deferred — switch when
  traffic warrants.

## Risks / follow-ups

- **CI test step still failing** (Sprint 1 commit): needs 2 secrets
  (`NEON_TEST_DATABASE_URL` = app role, `NEON_TEST_DATABASE_URL_OWNER` = owner).
  Tracked as separate task. CI workflow already updated; just needs secrets.
- **Rate limit unit tests not added**: integration tests with mocked Upstash
  would be nice. Defer to Sprint 3 if time.
- **Admin domain**: `admin.masjidmu.id` planned but not yet split into
  separate UI flow. Currently super_admin uses regular login + permission
  bypass.
- **Permission cache invalidation**: `invalidatePermissionCache()` exposed
  but not yet called from role-mutation endpoints. Wire in Sprint 3 when
  building role management UI.

## Next: Sprint 3 — Akuntansi part 1

Goal: COA + transactions CRUD + state machine + first journal posted.

- Modul `accounting/accounts` (COA hierarchical, seed PSAK 45)
- Modul `accounting/transaction-categories` (kategori → COA mapping)
- Modul `accounting/transactions` (CRUD + state machine + approval)
- `FinancialValidator` ported from CI4
- Decimal.js for all money math
- Tests: validator + state machine + approval flow

Hard gates for Sprint 3:
- Create transaction → submit → approve → posted
- Journal auto-generated on post (atomic, balanced)
- DB CHECK + balance trigger reject invalid journals
- All 7 PSAK 45 reports executable as views (Sprint 4 implements export)
