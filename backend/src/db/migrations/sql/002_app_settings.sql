-- ─────────────────────────────────────────────────────────────────────────
-- 002_app_settings.sql
-- Postgres session GUCs we use to scope RLS:
--   app.current_tenant_id  -- UUID of the tenant making the request
--   app.current_user_role  -- 'super_admin' to bypass RLS, otherwise unset
--
-- Both are set via `SELECT set_config(name, value, true)` inside a transaction
-- by `withTenant()` / `asSuperAdmin()` in src/db/client.ts.
--
-- This file just registers harmless defaults so SHOW returns empty string
-- instead of "ERROR: unrecognized configuration parameter" when context not set.
-- ─────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  PERFORM set_config('app.current_tenant_id', '', false);
  PERFORM set_config('app.current_user_role', '', false);
END $$;
