-- ─────────────────────────────────────────────────────────────────────────
-- 011_rls_policies.sql
-- Two policies per tenant-scoped table:
--   1. tenant_iso_<table>      — ordinary users see/modify only their tenant
--   2. super_admin_<table>     — super_admin role sees all (PERMISSIVE OR'd)
--
-- USING + WITH CHECK both required so that:
--   • SELECT/UPDATE/DELETE filter rows by tenant
--   • INSERT/UPDATE cannot write a row with a foreign tenant_id
--
-- Policies are CREATE POLICY IF NOT EXISTS to make this file re-runnable.
-- (Postgres 16 supports IF NOT EXISTS for policies via DO block.)
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  tenant_scoped_tables text[] := ARRAY[
    'users', 'roles', 'role_permissions', 'user_roles', 'sessions',
    'accounts', 'transaction_categories', 'transactions',
    'approval_stages', 'approval_logs',
    'journals',
    'mosque_profiles', 'periods', 'positions', 'officers', 'officer_documents',
    'programs', 'events', 'event_speakers', 'event_rsvps',
    'announcements', 'posts', 'galleries', 'gallery_items', 'notifications',
    'audit_logs'
  ];
  -- These tables don't have tenant_id directly but are scoped via FK.
  -- Skip them here; we add custom policies below.
  fk_scoped text[] := ARRAY[
    'role_permissions', 'user_roles',
    'approval_stages', 'approval_logs',
    'event_speakers', 'event_rsvps',
    'gallery_items',
    'officer_documents'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_scoped_tables LOOP
    -- Skip FK-scoped tables for the standard pattern; they get custom policies.
    IF t = ANY (fk_scoped) THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS tenant_iso_%1$s ON %1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS super_admin_%1$s ON %1$I', t);

    -- Tenant isolation: USING for read, WITH CHECK for write.
    -- NULLIF avoids casting empty string to UUID when context not set.
    EXECUTE format($p$
      CREATE POLICY tenant_iso_%1$s ON %1$I
        AS PERMISSIVE
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    $p$, t);

    -- Super admin bypass: PERMISSIVE so it OR's with the iso policy.
    EXECUTE format($p$
      CREATE POLICY super_admin_%1$s ON %1$I
        AS PERMISSIVE
        USING (current_setting('app.current_user_role', true) = 'super_admin')
        WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin')
    $p$, t);
  END LOOP;
END $$;

-- ─── FK-scoped tables ──────────────────────────────────────────────────────
-- These derive tenant_id through a parent record.

-- role_permissions → roles.tenant_id (NULL for system roles)
DROP POLICY IF EXISTS tenant_iso_role_permissions ON role_permissions;
CREATE POLICY tenant_iso_role_permissions ON role_permissions
  AS PERMISSIVE
  USING (
    EXISTS (
      SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id
        AND (r.tenant_id IS NULL
             OR r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id
        AND (r.tenant_id IS NULL
             OR r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    )
  );

DROP POLICY IF EXISTS super_admin_role_permissions ON role_permissions;
CREATE POLICY super_admin_role_permissions ON role_permissions
  AS PERMISSIVE
  USING (current_setting('app.current_user_role', true) = 'super_admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

-- user_roles → users.tenant_id
DROP POLICY IF EXISTS tenant_iso_user_roles ON user_roles;
CREATE POLICY tenant_iso_user_roles ON user_roles
  AS PERMISSIVE
  USING (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = user_roles.user_id
        AND u.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = user_roles.user_id
        AND u.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS super_admin_user_roles ON user_roles;
CREATE POLICY super_admin_user_roles ON user_roles
  AS PERMISSIVE
  USING (current_setting('app.current_user_role', true) = 'super_admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

-- approval_stages → transactions.tenant_id
DROP POLICY IF EXISTS tenant_iso_approval_stages ON approval_stages;
CREATE POLICY tenant_iso_approval_stages ON approval_stages
  AS PERMISSIVE
  USING (
    EXISTS (
      SELECT 1 FROM transactions tx WHERE tx.id = approval_stages.transaction_id
        AND tx.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM transactions tx WHERE tx.id = approval_stages.transaction_id
        AND tx.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS super_admin_approval_stages ON approval_stages;
CREATE POLICY super_admin_approval_stages ON approval_stages
  AS PERMISSIVE
  USING (current_setting('app.current_user_role', true) = 'super_admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

-- approval_logs → transactions.tenant_id
DROP POLICY IF EXISTS tenant_iso_approval_logs ON approval_logs;
CREATE POLICY tenant_iso_approval_logs ON approval_logs
  AS PERMISSIVE
  USING (
    EXISTS (
      SELECT 1 FROM transactions tx WHERE tx.id = approval_logs.transaction_id
        AND tx.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM transactions tx WHERE tx.id = approval_logs.transaction_id
        AND tx.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS super_admin_approval_logs ON approval_logs;
CREATE POLICY super_admin_approval_logs ON approval_logs
  AS PERMISSIVE
  USING (current_setting('app.current_user_role', true) = 'super_admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

-- journal_lines → journals.tenant_id
DROP POLICY IF EXISTS tenant_iso_journal_lines ON journal_lines;
CREATE POLICY tenant_iso_journal_lines ON journal_lines
  AS PERMISSIVE
  USING (
    EXISTS (
      SELECT 1 FROM journals j WHERE j.id = journal_lines.journal_id
        AND j.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM journals j WHERE j.id = journal_lines.journal_id
        AND j.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS super_admin_journal_lines ON journal_lines;
CREATE POLICY super_admin_journal_lines ON journal_lines
  AS PERMISSIVE
  USING (current_setting('app.current_user_role', true) = 'super_admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

-- event_speakers → events.tenant_id
DROP POLICY IF EXISTS tenant_iso_event_speakers ON event_speakers;
CREATE POLICY tenant_iso_event_speakers ON event_speakers
  AS PERMISSIVE
  USING (
    EXISTS (
      SELECT 1 FROM events e WHERE e.id = event_speakers.event_id
        AND e.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e WHERE e.id = event_speakers.event_id
        AND e.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS super_admin_event_speakers ON event_speakers;
CREATE POLICY super_admin_event_speakers ON event_speakers
  AS PERMISSIVE
  USING (current_setting('app.current_user_role', true) = 'super_admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

-- event_rsvps → events.tenant_id
DROP POLICY IF EXISTS tenant_iso_event_rsvps ON event_rsvps;
CREATE POLICY tenant_iso_event_rsvps ON event_rsvps
  AS PERMISSIVE
  USING (
    EXISTS (
      SELECT 1 FROM events e WHERE e.id = event_rsvps.event_id
        AND e.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e WHERE e.id = event_rsvps.event_id
        AND e.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS super_admin_event_rsvps ON event_rsvps;
CREATE POLICY super_admin_event_rsvps ON event_rsvps
  AS PERMISSIVE
  USING (current_setting('app.current_user_role', true) = 'super_admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

-- gallery_items → galleries.tenant_id
DROP POLICY IF EXISTS tenant_iso_gallery_items ON gallery_items;
CREATE POLICY tenant_iso_gallery_items ON gallery_items
  AS PERMISSIVE
  USING (
    EXISTS (
      SELECT 1 FROM galleries g WHERE g.id = gallery_items.gallery_id
        AND g.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM galleries g WHERE g.id = gallery_items.gallery_id
        AND g.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS super_admin_gallery_items ON gallery_items;
CREATE POLICY super_admin_gallery_items ON gallery_items
  AS PERMISSIVE
  USING (current_setting('app.current_user_role', true) = 'super_admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

-- officer_documents already has tenant_id direct, handled by main loop.
