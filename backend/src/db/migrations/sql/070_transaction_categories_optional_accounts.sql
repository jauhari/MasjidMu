-- ─────────────────────────────────────────────────────────────────────────
-- 070_transaction_categories_optional_accounts.sql
-- Relax debit_account_id / credit_account_id requirement based on direction.
--
-- Business rule (sesuai PSAK 45 / praktik akuntansi standar):
--   Pemasukan  : credit_account = WAJIB (akun pendapatan), debit  opsional (kas/bank biasanya pasti dipakai)
--   Pengeluaran: debit_account  = WAJIB (akun beban),       credit opsional (kas/bank biasanya pasti dipakai)
--
-- Saat user pilih kategori di transaksi, line yang akun-nya null tidak ikut
-- auto-fill — user pilih sendiri kas/bank-nya.
--
-- Re-runnable: pakai IF EXISTS + DROP CONSTRAINT idiom.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE transaction_categories ALTER COLUMN debit_account_id  DROP NOT NULL;
ALTER TABLE transaction_categories ALTER COLUMN credit_account_id DROP NOT NULL;

-- Direction-based requirement.
ALTER TABLE transaction_categories
  DROP CONSTRAINT IF EXISTS tc_account_required_by_direction;

ALTER TABLE transaction_categories
  ADD CONSTRAINT tc_account_required_by_direction CHECK (
    (direction = 'income'  AND credit_account_id IS NOT NULL) OR
    (direction = 'expense' AND debit_account_id  IS NOT NULL)
  );
