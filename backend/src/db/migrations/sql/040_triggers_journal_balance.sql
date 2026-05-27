-- ─────────────────────────────────────────────────────────────────────────
-- 040_triggers_journal_balance.sql
-- Enforce SUM(debit) = SUM(credit) per journal at COMMIT time.
--
-- Why CONSTRAINT TRIGGER + DEFERRABLE INITIALLY DEFERRED:
--   • Lines are inserted one-by-one — at row 1, the journal isn't balanced yet.
--   • DEFERRED defers the check until COMMIT, so we only validate the final state.
--
-- Why AFTER INSERT/UPDATE/DELETE FOR EACH ROW:
--   • Any line mutation can break balance, so we re-check.
--   • Row-level fires multiple times for batch ops, but the trigger body is
--     cheap (single SUM), and the final COMMIT-time check is what matters.
--
-- Tolerance is 0 — IDR has no sub-unit. If multi-currency lands later, change
-- to ABS(d - c) > 0.001 here.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enforce_journal_balance() RETURNS trigger AS $$
DECLARE
  jid uuid;
  d numeric;
  c numeric;
BEGIN
  jid := COALESCE(NEW.journal_id, OLD.journal_id);

  -- If the parent journal was deleted (cascade), skip — no rows left.
  IF NOT EXISTS (SELECT 1 FROM journals WHERE id = jid) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO d, c
    FROM journal_lines
   WHERE journal_id = jid;

  IF d <> c THEN
    RAISE EXCEPTION 'Journal % unbalanced: debit=% credit=%', jid, d, c
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_journal_balance ON journal_lines;

CREATE CONSTRAINT TRIGGER trg_enforce_journal_balance
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_journal_balance();
