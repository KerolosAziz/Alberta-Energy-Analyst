-- The question path's own tables. Cache, log and rate limits live in PostgreSQL so
-- the app needs no other service. The read-only role gets nothing here: these tables are
-- touched only by the app through DATABASE_URL.

CREATE TABLE answer_cache (
    cache_key   text        PRIMARY KEY,   -- sha256(normalized question + latest data hour)
    id          text        NOT NULL UNIQUE,  -- short id for shareable links, /a/{id}
    question    text        NOT NULL,
    sql         text,
    columns     jsonb,
    rows        jsonb,
    answer      text,
    chart_hint  text,
    outcome     text        NOT NULL,
    provider    text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE query_log (
    id          bigserial   PRIMARY KEY,
    asked_at    timestamptz NOT NULL DEFAULT now(),
    question    text,
    sql         text,
    provider    text,
    latency_ms  integer,
    outcome     text,       -- answered | cached | refused | rejected | timeout | sql_error | empty | provider_error | rate_limited
    cached      boolean     NOT NULL DEFAULT false
);

CREATE TABLE rate_limits (
    ip_hash  text  NOT NULL,
    day      date  NOT NULL,
    count    integer NOT NULL DEFAULT 0,
    PRIMARY KEY (ip_hash, day)
);
