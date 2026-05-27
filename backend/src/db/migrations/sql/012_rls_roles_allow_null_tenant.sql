-- ─────────────────────────────────────────────────────────────────────────
-- 012_rls_roles_allow_null_tenant.sql
-- The default tenant_iso policy filters tenant_id = <ctx>. For roles,
-- we also need to expose system roles (tenant_id IS NULL) to all tenants
-- so they can grant `super_admin` etc. without bypassing RLS.
--
-- Replace tenant_iso_roles with a version that allows either match or NULL.
-- WITH CHECK still requires tenant_id = ctx for INSERT/UPDATE — system role
-- mutation must go through super_admin context.
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS tenant_iso_roles ON roles;

CREATE POLICY tenant_iso_roles ON roles
  AS PERMISSIVE
  USING (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- role_permissions: same idea — allow read of grants on system roles.
-- The existing policy already EXISTS-checks roles, which itself allows NULL,
-- so no change needed there.
