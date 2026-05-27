# Sprint 1 — Done

**Date completed:** 2026-05-27 (single session, target was 5 days)
**Status:** All hard gates passed. Ready for Sprint 2.

## What was built

### Schema (29 tables, English enum values)
- **core** (7): tenants, users, roles, permissions, role_permissions, user_roles, sessions
- **accounting** (7): accounts, transaction_categories, transactions, approval_stages, approval_logs, journals, journal_lines
- **organization** (5): mosque_profiles, periods, positions, officers, officer_documents
- **content** (9): programs, events, event_speakers, event_rsvps, announcements, posts, galleries, gallery_items, notifications
- **audit** (1): audit_logs

LAZIS / PSAK 109 deferred to V2 backlog (~14 tables saved).

### RLS (Row-Level Security)
- 52 policies across 27 tenant-scoped tables
- Two policies per table: `tenant_iso_<table>` + `super_admin_<table>`
- FK-scoped tables (journal_lines, role_permissions, etc.) use parent lookup
- `roles` policy allows `tenant_id IS NULL` for system roles
- App role `masjidmu_app` (NOBYPASSRLS) — RLS actually applies
- Owner role `neondb_owner` reserved for migrations only

### Triggers & constraints
- `journal_lines` CHECK: debit≥0, credit≥0, debit XOR credit
- `trg_enforce_journal_balance`: CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED
- Tolerance = 0 (IDR no sub-unit)

### Tooling
- Migration runner (Drizzle + raw SQL companions)
- DB reset script (dev only)
- App role provisioning script
- Seed script (idempotent: 31 permissions + super_admin role + grants)
- Acceptance gate runner (9 checks, machine-verifiable)

### Tests live against real Neon (16 total)
- 7 RLS isolation tests (cross-tenant SELECT/UPDATE/INSERT/findById, super_admin bypass, default deny, GUC isolation)
- 4 journal balance tests (balanced accept, unbalanced reject, XOR violation, negative)
- 4 telegram tests
- 1 healthz integration

## Surprises along the way

| | What we expected | What actually happened |
|---|---|---|
| pg_partman | Likely unavailable on Neon, prepare manual fallback | **Available, v5.1.0** installed |
| Neon role | Use connection string as-is | `neondb_owner` has BYPASSRLS — RLS doesn't apply unless we create separate non-bypass app role |
| RLS on system roles | Default policy works | Needed special policy allowing `tenant_id IS NULL` for shared system roles |
| Drizzle-kit | v0.28 chokes on ESM `.js` imports | Upgraded to v0.31 — works |

## Hard gates (all passed)

1. ✅ Schema parity (29/29)
2. ✅ RLS enabled on all 27 tenant-scoped tables
3. ✅ 52 RLS policies created
4. ✅ Journal CHECK constraints
5. ✅ Journal balance trigger (deferrable)
6. ✅ account_type enum English
7. ✅ App role NOBYPASSRLS verified
8. ✅ Seed complete
9. ✅ pg_partman available

## Next: Sprint 2 — Auth & Tenant

Goal: login → cookie → tenant context auto-applied end-to-end.

- better-auth setup with Drizzle adapter + organization plugin
- Tenant resolver middleware (subdomain → tenant_id)
- Permission middleware + Redis cache
- Rate limiter (Upstash sliding window)
- Audit interceptor (BullMQ async write)
- Modul `core`: auth routes, tenants CRUD, users CRUD
- Seed first super_admin user for testing

## Risks & follow-ups

- `pg_partman` available but partition setup deferred to Sprint 4-5 (when transactions + audit_logs grow).
- `journal_lines.account_id` has no ON DELETE CASCADE — fine for MVP, may revisit if account hard-deletes need to cascade (currently soft-delete only).
- Migration runner uses `DATABASE_URL_OWNER` for DDL, app uses `DATABASE_URL` for runtime. CI must inject both.
