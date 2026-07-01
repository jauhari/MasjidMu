-- ─────────────────────────────────────────────────────────────────────────
-- 092_tenant_parent.sql
-- Relasi induk-anak antar tenant untuk konsolidasi multi-entitas.
-- Tenant induk (mis. LazisNu pusat / BAZNAS provinsi) memayungi cabang;
-- NULL = entitas mandiri.
--
-- Aman untuk data lama: kolom NULLABLE, tenant lama tetap mandiri.
-- Re-runnable: ADD COLUMN IF NOT EXISTS + guard FK.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS parent_tenant_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_parent_tenant_id_fk') THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_parent_tenant_id_fk
      FOREIGN KEY (parent_tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tenants_parent_tenant_id_index ON tenants (parent_tenant_id);
