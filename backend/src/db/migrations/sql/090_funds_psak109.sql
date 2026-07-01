-- ─────────────────────────────────────────────────────────────────────────
-- 090_funds_psak109.sql
-- Dimensi Dana (fund accounting) untuk PSAK 109 (zakat/infak-sedekah/amil/
-- non-halal) dan PSAK 112 (wakaf). Tiap baris jurnal/transaksi bisa ditag
-- dengan satu dana sehingga bisa dibuat "Laporan Sumber & Penggunaan Dana"
-- per dana.
--
-- Aman untuk data lama: kolom fund_id NULLABLE. Edisi masjid/ISAK-35 biarin
-- null (dana tunggal 'umum'); edisi ZakatMu yang enforce non-null di app.
--
-- Re-runnable: pakai IF NOT EXISTS / guard pg_catalog.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Enum jenis dana (CREATE TYPE tidak punya IF NOT EXISTS — guard manual).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fund_type') THEN
    CREATE TYPE fund_type AS ENUM
      ('zakat', 'infaq_sedekah', 'amil', 'nonhalal', 'wakaf', 'umum');
  END IF;
END $$;

-- 2. Tabel funds (Dana).
CREATE TABLE IF NOT EXISTS funds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          varchar(20) NOT NULL,
  name          varchar(200) NOT NULL,
  fund_type     fund_type NOT NULL,
  is_restricted boolean NOT NULL DEFAULT false,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  is_system     boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT funds_tenant_code_unique UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS funds_tenant_id_index ON funds (tenant_id);

-- 3. Kolom fund_id di baris transaksi & jurnal.
ALTER TABLE transaction_lines ADD COLUMN IF NOT EXISTS fund_id uuid;
ALTER TABLE journal_lines     ADD COLUMN IF NOT EXISTS fund_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transaction_lines_fund_id_fk') THEN
    ALTER TABLE transaction_lines
      ADD CONSTRAINT transaction_lines_fund_id_fk
      FOREIGN KEY (fund_id) REFERENCES funds(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_lines_fund_id_fk') THEN
    ALTER TABLE journal_lines
      ADD CONSTRAINT journal_lines_fund_id_fk
      FOREIGN KEY (fund_id) REFERENCES funds(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS transaction_lines_fund_id_index ON transaction_lines (fund_id);
CREATE INDEX IF NOT EXISTS journal_lines_fund_id_index     ON journal_lines (fund_id);

-- 4. RLS: funds tenant-scoped, pola sama dengan 010/011.
ALTER TABLE funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE funds FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_iso_funds ON funds;
DROP POLICY IF EXISTS super_admin_funds ON funds;

CREATE POLICY tenant_iso_funds ON funds
  AS PERMISSIVE
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY super_admin_funds ON funds
  AS PERMISSIVE
  USING (current_setting('app.current_user_role', true) = 'super_admin')
  WITH CHECK (current_setting('app.current_user_role', true) = 'super_admin');

-- 5. Grant ke app-role bila ada (env single-role boleh skip).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'masjidmu_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON funds TO masjidmu_app;
  END IF;
END $$;
