-- ─────────────────────────────────────────────────────────────────────────
-- 093_event_recurrence.sql
-- Event berulang: mingguan, selapanan (35 hari), interval hari, bulanan.
-- Setiap occurrence = baris event terpisah, dikelompokkan via series_id.
-- Re-runnable: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE events ADD COLUMN IF NOT EXISTS series_id uuid;
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_type varchar(20) NOT NULL DEFAULT 'none';
ALTER TABLE events ADD COLUMN IF NOT EXISTS interval_days integer;
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_weekday smallint;
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_until timestamptz;
ALTER TABLE events ADD COLUMN IF NOT EXISTS occurrence_index integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS events_series_id_index ON events (series_id);