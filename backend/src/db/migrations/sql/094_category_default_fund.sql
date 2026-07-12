-- 094_category_default_fund.sql
-- Kategori transaksi boleh membawa default dana (PSAK 109):
-- pilih "Infaq PAP" → isi akun + tag dana PAP otomatis.

ALTER TABLE transaction_categories
  ADD COLUMN IF NOT EXISTS default_fund_id uuid
    REFERENCES funds(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS transaction_categories_default_fund_id_idx
  ON transaction_categories (default_fund_id)
  WHERE default_fund_id IS NOT NULL;

COMMENT ON COLUMN transaction_categories.default_fund_id IS
  'Opsional: saat kategori dipilih di form transaksi, fund_id baris diisi otomatis (bisa diubah user).';
