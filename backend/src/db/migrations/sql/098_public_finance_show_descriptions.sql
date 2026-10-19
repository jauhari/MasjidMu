-- 098_public_finance_show_descriptions.sql
-- Per-tenant opt-in for showing transaction descriptions (keterangan, with
-- personal names masked) in the public finance report's Buku Kas. Defaults
-- to false: a tenant that has not explicitly turned it on keeps showing
-- only category names, exactly as before this column existed.
ALTER TABLE public_finance_reports
  ADD COLUMN IF NOT EXISTS show_descriptions boolean NOT NULL DEFAULT false;
