-- Sprint 4: Report views & materialized views.
--
-- Strategy:
--   - Materialized views for dashboard aggregates (stale up to 17 min, refreshed by cron)
--   - Regular views for live detail reports (GL, Trial Balance)
--
-- All views are tenant-agnostic at the SQL level; tenant scoping is enforced
-- by RLS on the underlying tables (journals, journal_lines, accounts) when
-- queried through `withTenant()`.

-- ─── mv_account_balances ─────────────────────────────────────────────────
-- Per (tenant, account, month): total debit, credit, net movement.
-- Net is signed by normal_balance so summing across asset accounts gives
-- a positive asset balance.
DROP MATERIALIZED VIEW IF EXISTS mv_account_balances CASCADE;

CREATE MATERIALIZED VIEW mv_account_balances AS
SELECT
  j.tenant_id,
  jl.account_id,
  a.code              AS account_code,
  a.name              AS account_name,
  a.account_type,
  a.normal_balance,
  date_trunc('month', j.journal_date)::date AS period_month,
  SUM(jl.debit)::numeric(18, 2)             AS total_debit,
  SUM(jl.credit)::numeric(18, 2)            AS total_credit,
  CASE
    WHEN a.normal_balance = 'debit'  THEN SUM(jl.debit)  - SUM(jl.credit)
    WHEN a.normal_balance = 'credit' THEN SUM(jl.credit) - SUM(jl.debit)
  END::numeric(18, 2) AS net_movement
FROM journal_lines jl
JOIN journals j  ON j.id = jl.journal_id
JOIN accounts a  ON a.id = jl.account_id
WHERE a.deleted_at IS NULL
GROUP BY j.tenant_id, jl.account_id, a.code, a.name, a.account_type, a.normal_balance,
         date_trunc('month', j.journal_date);

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS mv_account_balances_pk
  ON mv_account_balances (tenant_id, account_id, period_month);

CREATE INDEX IF NOT EXISTS mv_account_balances_tenant_period
  ON mv_account_balances (tenant_id, period_month);

CREATE INDEX IF NOT EXISTS mv_account_balances_type
  ON mv_account_balances (tenant_id, account_type, period_month);


-- ─── mv_monthly_summary ──────────────────────────────────────────────────
-- Per (tenant, month): total income, expense, surplus.
-- Surplus = pendapatan − beban (PSAK 45 "perubahan aset neto").
DROP MATERIALIZED VIEW IF EXISTS mv_monthly_summary CASCADE;

CREATE MATERIALIZED VIEW mv_monthly_summary AS
SELECT
  tenant_id,
  period_month,
  COALESCE(SUM(net_movement) FILTER (WHERE account_type = 'income'),  0)::numeric(18, 2) AS total_income,
  COALESCE(SUM(net_movement) FILTER (WHERE account_type = 'expense'), 0)::numeric(18, 2) AS total_expense,
  (
    COALESCE(SUM(net_movement) FILTER (WHERE account_type = 'income'),  0)
    - COALESCE(SUM(net_movement) FILTER (WHERE account_type = 'expense'), 0)
  )::numeric(18, 2) AS surplus_deficit
FROM mv_account_balances
GROUP BY tenant_id, period_month;

CREATE UNIQUE INDEX IF NOT EXISTS mv_monthly_summary_pk
  ON mv_monthly_summary (tenant_id, period_month);


-- ─── v_general_ledger ────────────────────────────────────────────────────
-- Flat view of every journal line with account + journal context.
-- Used for: General Ledger detail, Jurnal Umum, drill-down from reports.
CREATE OR REPLACE VIEW v_general_ledger AS
SELECT
  j.tenant_id,
  jl.id           AS line_id,
  j.id            AS journal_id,
  j.journal_no,
  j.journal_date,
  j.transaction_id,
  j.description   AS journal_description,
  jl.account_id,
  a.code          AS account_code,
  a.name          AS account_name,
  a.account_type,
  a.normal_balance,
  jl.debit,
  jl.credit,
  jl.description  AS line_description,
  jl.sort_order
FROM journal_lines jl
JOIN journals j ON j.id = jl.journal_id
JOIN accounts a ON a.id = jl.account_id;


-- ─── v_trial_balance ─────────────────────────────────────────────────────
-- Per (tenant, account) cumulative debit/credit + closing position.
-- Period filtering happens in the calling query (WHERE journal_date BETWEEN ...).
-- For pre-period filtering use the raw view together with date predicates.
CREATE OR REPLACE VIEW v_trial_balance AS
SELECT
  j.tenant_id,
  jl.account_id,
  a.code           AS account_code,
  a.name           AS account_name,
  a.account_type,
  a.normal_balance,
  j.journal_date,
  jl.debit,
  jl.credit
FROM journal_lines jl
JOIN journals j ON j.id = jl.journal_id
JOIN accounts a ON a.id = jl.account_id
WHERE a.deleted_at IS NULL;


-- ─── Initial population ──────────────────────────────────────────────────
-- Seed materialized views with current data so first reads work immediately.
REFRESH MATERIALIZED VIEW mv_account_balances;
REFRESH MATERIALIZED VIEW mv_monthly_summary;
