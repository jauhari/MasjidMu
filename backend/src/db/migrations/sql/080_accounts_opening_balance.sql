-- ─────────────────────────────────────────────────────────────────────────
-- 080_accounts_opening_balance.sql
-- Tambah kolom opening_balance di accounts buat simpan saldo awal.
--
-- Saldo awal dipakai sebagai titik mulai pencatatan akuntansi. Nilai ini
-- ditambahkan ke akumulasi mutasi jurnal untuk mendapatkan saldo total.
--
-- Re-runnable: pakai ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS opening_balance numeric(18, 2) NOT NULL DEFAULT 0;
