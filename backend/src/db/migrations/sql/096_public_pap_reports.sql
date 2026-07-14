-- ─────────────────────────────────────────────────────────────────────────
-- 096_public_pap_reports.sql
-- Konfigurasi publikasi laporan transparansi Dana PAP per tenant.
-- Satu tenant memilih satu fund aktif sebagai laporan publik yang bisa
-- diterbitkan/dicabut tanpa membuka report internal.
-- ─────────────────────────────────────────────────────────────────────────

-- Composite FK target: pastikan configured fund selalu milik tenant yang sama.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'funds_tenant_id_id_unique') THEN
    ALTER TABLE funds ADD CONSTRAINT funds_tenant_id_id_unique UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public_pap_reports (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  fund_id       uuid NOT NULL,
  is_published  boolean NOT NULL DEFAULT false,
  published_at  timestamptz,
  published_by  uuid REFERENCES users(id),
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_pap_reports_tenant_fund_fk
    FOREIGN KEY (tenant_id, fund_id) REFERENCES funds(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS public_pap_reports_fund_id_index ON public_pap_reports (fund_id);
CREATE INDEX IF NOT EXISTS public_pap_reports_published_index ON public_pap_reports (is_published);

ALTER TABLE public_pap_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_pap_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_iso_public_pap_reports ON public_pap_reports;
DROP POLICY IF EXISTS super_admin_public_pap_reports ON public_pap_reports;

CREATE POLICY tenant_iso_public_pap_reports ON public_pap_reports
  AS PERMISSIVE
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY super_admin_public_pap_reports ON public_pap_reports
  AS PERMISSIVE
  USING (current_setting('app.current_user_role', true) = 'super_admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'masjidmu_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public_pap_reports TO masjidmu_app;
  END IF;
END $$;
