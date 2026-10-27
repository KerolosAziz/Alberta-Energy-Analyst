-- The role the running app and the hourly job connect as, so neither needs the admin login.
--
-- It can read and upsert the market tables, log ingestion runs, and keep the app's own
-- tables (answer cache, query log, rate limits). No DELETE or TRUNCATE on the market data,
-- no DDL, no access to schema_migrations, no creating roles or databases. Every statement is
-- cut off after 30 seconds. Like app_readonly, it is created with no password: ingest.migrate
-- sets one from DATABASE_URL_APP, so a hosted database gets its own.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_writer') THEN
        CREATE ROLE app_writer LOGIN;
    END IF;
END
$$;

ALTER ROLE app_writer SET statement_timeout = '30s';

GRANT USAGE ON SCHEMA public TO app_writer;
GRANT SELECT, INSERT, UPDATE ON pool_price, system_load, answer_cache TO app_writer;
GRANT INSERT ON ingestion_runs, query_log TO app_writer;
GRANT USAGE ON SEQUENCE ingestion_runs_id_seq, query_log_id_seq TO app_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO app_writer;
