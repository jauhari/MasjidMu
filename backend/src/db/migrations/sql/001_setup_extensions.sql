-- ─────────────────────────────────────────────────────────────────────────
-- 001_setup_extensions.sql
-- Postgres extensions we rely on. uuid-ossp for legacy uuid_generate_v4()
-- (Drizzle uses gen_random_uuid() from pgcrypto/built-in, but having both
-- is safe). pg_trgm for fuzzy/ILIKE accelerations later. pg_partman is
-- attempted; absence is logged and we fall back to manual partitioning.
-- ─────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_partman') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_partman';
    RAISE NOTICE 'pg_partman: available, extension enabled';
  ELSE
    RAISE NOTICE 'pg_partman: NOT available on this Postgres — using manual partitioning fallback in app code';
  END IF;
END $$;
