CREATE TABLE IF NOT EXISTS accounting_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_type varchar(50) NOT NULL,
  source_type varchar(20),
  source_fingerprint varchar(64) NOT NULL,
  payload_fingerprint varchar(64) NOT NULL,
  fund_id uuid REFERENCES funds(id),
  reason text,
  row_count integer NOT NULL,
  imported_count integer,
  status varchar(20) NOT NULL DEFAULT 'processing',
  result jsonb,
  error text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  CONSTRAINT accounting_import_batch_status_check CHECK (status IN ('processing', 'committed', 'failed')),
  CONSTRAINT accounting_import_batches_tenant_type_source_unique
    UNIQUE (tenant_id, import_type, source_fingerprint)
);


ALTER TABLE accounting_import_batches
  ADD COLUMN IF NOT EXISTS source_type varchar(20),
  ADD COLUMN IF NOT EXISTS fund_id uuid REFERENCES funds(id),
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS row_count integer,
  ADD COLUMN IF NOT EXISTS imported_count integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE accounting_import_batches
SET row_count = 0
WHERE row_count IS NULL;

ALTER TABLE accounting_import_batches
  ALTER COLUMN row_count SET NOT NULL;

CREATE INDEX IF NOT EXISTS accounting_import_batches_payload_idx
  ON accounting_import_batches (payload_fingerprint);

ALTER TABLE accounting_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_import_batches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_import_batches_tenant_isolation ON accounting_import_batches;
CREATE POLICY accounting_import_batches_tenant_isolation ON accounting_import_batches
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.current_user_role', true) = 'super_admin'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.current_user_role', true) = 'super_admin'
  );
