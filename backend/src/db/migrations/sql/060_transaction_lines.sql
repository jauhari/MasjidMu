-- ─────────────────────────────────────────────────────────────────────────
-- 060_transaction_lines.sql
-- Multi-line transaction entries (proper double-entry bookkeeping at tx level).
--
-- Each transaction can have N lines. SUM(debit) MUST equal SUM(credit) at
-- COMMIT time, validated by trigger (same pattern as journal_lines).
--
-- categoryId becomes nullable on transactions — kept as optional shortcut
-- (auto-fills 2 lines from category.debit/credit accounts in the UI), but
-- transactions can be entered freeform with N custom lines.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transaction_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id),
  debit           numeric(18, 2) NOT NULL DEFAULT 0,
  credit          numeric(18, 2) NOT NULL DEFAULT 0,
  description     text,
  sort_order      integer NOT NULL DEFAULT 0,
  CONSTRAINT tl_debit_non_neg CHECK (debit >= 0),
  CONSTRAINT tl_credit_non_neg CHECK (credit >= 0),
  CONSTRAINT tl_debit_xor_credit CHECK (
    (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)
  )
);

CREATE INDEX IF NOT EXISTS transaction_lines_tx_idx ON transaction_lines (transaction_id);
CREATE INDEX IF NOT EXISTS transaction_lines_account_idx ON transaction_lines (account_id);

-- RLS: derive tenant via parent transaction (FK-scoped pattern, like journal_lines).
-- Uses the same GUC names as 011_rls_policies.sql:
--   app.current_tenant_id   ← set by withTenant()
--   app.current_user_role   ← set to 'super_admin' by asSuperAdmin()
ALTER TABLE transaction_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_lines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tl_tenant_iso ON transaction_lines;
DROP POLICY IF EXISTS tenant_iso_transaction_lines ON transaction_lines;
CREATE POLICY tenant_iso_transaction_lines ON transaction_lines
  AS PERMISSIVE
  USING (
    EXISTS (
      SELECT 1 FROM transactions tx
       WHERE tx.id = transaction_lines.transaction_id
         AND tx.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM transactions tx
       WHERE tx.id = transaction_lines.transaction_id
         AND tx.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS super_admin_transaction_lines ON transaction_lines;
CREATE POLICY super_admin_transaction_lines ON transaction_lines
  AS PERMISSIVE
  USING (current_setting('app.current_user_role', true) = 'super_admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

-- categoryId nullable
ALTER TABLE transactions ALTER COLUMN category_id DROP NOT NULL;

-- Backfill: generate 2 lines per existing transaction from its category mapping.
-- Skip transactions that already have lines (idempotent).
INSERT INTO transaction_lines (transaction_id, account_id, debit, credit, sort_order)
SELECT t.id, tc.debit_account_id, t.amount, 0, 0
  FROM transactions t
  JOIN transaction_categories tc ON tc.id = t.category_id
 WHERE t.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM transaction_lines tl WHERE tl.transaction_id = t.id);

INSERT INTO transaction_lines (transaction_id, account_id, debit, credit, sort_order)
SELECT t.id, tc.credit_account_id, 0, t.amount, 1
  FROM transactions t
  JOIN transaction_categories tc ON tc.id = t.category_id
 WHERE t.deleted_at IS NULL
   AND (SELECT COUNT(*) FROM transaction_lines tl WHERE tl.transaction_id = t.id) = 1;

-- Balance trigger: SUM(debit) = SUM(credit) per transaction at COMMIT time.
CREATE OR REPLACE FUNCTION enforce_transaction_balance() RETURNS trigger AS $$
DECLARE
  tid uuid;
  d numeric;
  c numeric;
BEGIN
  tid := COALESCE(NEW.transaction_id, OLD.transaction_id);

  IF NOT EXISTS (SELECT 1 FROM transactions WHERE id = tid) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO d, c
    FROM transaction_lines
   WHERE transaction_id = tid;

  IF d <> c THEN
    RAISE EXCEPTION 'Transaction % unbalanced: debit=% credit=%', tid, d, c
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_transaction_balance ON transaction_lines;

CREATE CONSTRAINT TRIGGER trg_enforce_transaction_balance
  AFTER INSERT OR UPDATE OR DELETE ON transaction_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_transaction_balance();
