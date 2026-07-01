-- ─────────────────────────────────────────────────────────────────────────
-- 091_tenant_edition.sql
-- Jenis lembaga (edisi) per tenant — menentukan dana yang di-seed + branding.
--   masjid (default) | laz | pesantren | yayasan
--
-- Aman untuk data lama: kolom NOT NULL DEFAULT 'masjid', jadi tenant yang
-- sudah ada otomatis jadi edisi masjid (perilaku tak berubah).
--
-- Re-runnable: guard pg_type + ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_edition') THEN
    CREATE TYPE tenant_edition AS ENUM ('masjid', 'laz', 'pesantren', 'yayasan');
  END IF;
END $$;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS edition tenant_edition NOT NULL DEFAULT 'masjid';
