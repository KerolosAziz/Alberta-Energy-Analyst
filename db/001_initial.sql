-- The two v1 market tables and the ingestion log.
--
-- One row per hour, keyed on the UTC hour beginning. begin_mpt is the same hour on the
-- Alberta clock (Mountain Prevailing Time). It repeats one hour each November, so it is
-- indexed but never a key. Questions about days and months filter on begin_mpt.

CREATE TABLE pool_price (
    begin_utc            timestamptz PRIMARY KEY,
    begin_mpt            timestamp   NOT NULL,
    pool_price           numeric(8,2),           -- $/MWh; NULL until the hour has settled
    forecast_pool_price  numeric(8,2),
    rolling_30day_avg    numeric(8,2)
);
CREATE INDEX pool_price_begin_mpt_idx ON pool_price (begin_mpt);

CREATE TABLE system_load (
    begin_utc         timestamptz PRIMARY KEY,
    begin_mpt         timestamp   NOT NULL,
    actual_load_mw    numeric(10,2),             -- NULL from the current hour onward
    forecast_load_mw  numeric(10,2)              -- about 14 days ahead, revised by the AESO
);
CREATE INDEX system_load_begin_mpt_idx ON system_load (begin_mpt);

CREATE TABLE ingestion_runs (
    id             bigserial   PRIMARY KEY,
    dataset        text        NOT NULL,         -- pool_price | system_load
    started_at     timestamptz NOT NULL,
    finished_at    timestamptz,
    rows_upserted  integer,
    status         text        NOT NULL CHECK (status IN ('ok', 'failed')),
    error          text
);
