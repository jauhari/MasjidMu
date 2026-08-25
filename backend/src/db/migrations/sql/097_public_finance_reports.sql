-- 097_public_finance_reports.sql
-- Whole-tenant financial transparency publication (no fund required),
-- sibling to public_pap_reports (096) which requires a PSAK 109 fund.
CREATE TABLE IF NOT EXISTS public_finance_reports (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  is_published  boolean NOT NULL DEFAULT false,
  published_at  timestamptz,
  published_by  uuid REFERENCES users(id),
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_finance_reports_is_published_idx
  ON public_finance_reports (is_published);
