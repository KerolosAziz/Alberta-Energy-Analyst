-- The read-only role the question path uses to run model-written SQL.
--
-- It can only SELECT from the two market tables. No INSERT, UPDATE, DELETE, no access to
-- ingestion_runs or schema_migrations. Transactions default to read-only and every
-- statement is cut off after 5 seconds. Both are defaults that a direct login could change,
-- which is why the password matters: it is not in this file. ingest.migrate sets it from
-- DATABASE_URL_READONLY right after the migrations, so the role cannot log in before that
-- and a hosted database gets its own.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
        CREATE ROLE app_readonly LOGIN;
    END IF;
END
$$;

ALTER ROLE app_readonly SET default_transaction_read_only = on;
ALTER ROLE app_readonly SET statement_timeout = '5s';

GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT SELECT ON pool_price, system_load TO app_readonly;
