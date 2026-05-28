-- ─────────────────────────────────────────────────────────────────────────
-- 010_rls_enable.sql
-- Enable Row-Level Security on every tenant-scoped table.
--
-- FORCE ROW LEVEL SECURITY: applies the policy even to the table owner
-- (without FORCE, owners bypass RLS — that includes our pg user).
--
-- Tables NOT enabled here:
--   • tenants               — needed before context is set (subdomain → tenant_id)
--   • permissions           — global registry, not tenant-scoped
--   • migrations            — drizzle metadata
--   • journal_lines         — derives tenant_id via parent journal (handled in 011)
--   • better-auth tables    — user/session/account/verification/organization/
--                              member/invitation handled by better-auth itself.
--                              We DO NOT enable RLS on these — better-auth
--                              expects to own them. Tenant scoping for
--                              app-domain queries goes through `users` (which
--                              has tenant_id and IS RLS-protected).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  tenant_scoped_tables text[] := ARRAY[
    -- core (sessions removed: handled by better-auth)
    'users', 'roles', 'role_permissions', 'user_roles',
    -- accounting
    'accounts', 'transaction_categories', 'transactions',
    'approval_stages', 'approval_logs',
    'journals',
    -- organization
    'mosque_profiles', 'periods', 'positions', 'officers', 'officer_documents',
    -- content
    'programs', 'events', 'event_speakers', 'event_rsvps',
    'announcements', 'posts', 'galleries', 'gallery_items', 'notifications',
    -- audit
    'audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_scoped_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- journal_lines: enable RLS but policies in 011 use parent journal lookup
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;
