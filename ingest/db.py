"""Database side of ingestion: connection, upserts, and the ingestion_runs log."""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime

import psycopg
from psycopg import sql

from ingest.settings import require_env

# Column order matches the rows ingest.aeso.parse_rows builds: begin_utc, begin_mpt, values.
UPSERT = {
    "pool_price": """
        INSERT INTO pool_price
            (begin_utc, begin_mpt, pool_price, forecast_pool_price, rolling_30day_avg)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (begin_utc) DO UPDATE SET
            begin_mpt = EXCLUDED.begin_mpt,
            pool_price = EXCLUDED.pool_price,
            forecast_pool_price = EXCLUDED.forecast_pool_price,
            rolling_30day_avg = EXCLUDED.rolling_30day_avg
        """,
    "system_load": """
        INSERT INTO system_load (begin_utc, begin_mpt, actual_load_mw, forecast_load_mw)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (begin_utc) DO UPDATE SET
            begin_mpt = EXCLUDED.begin_mpt,
            actual_load_mw = EXCLUDED.actual_load_mw,
            forecast_load_mw = EXCLUDED.forecast_load_mw
        """,
}


def connect() -> psycopg.Connection:
    return psycopg.connect(require_env("DATABASE_URL"))


def upsert(conn: psycopg.Connection, dataset: str, rows: Sequence[tuple]) -> int:
    """Insert or update rows by UTC hour and commit. Returns the number of rows written."""
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(UPSERT[dataset], rows)
        written = cur.rowcount
    conn.commit()
    return written


def count_rows(conn: psycopg.Connection, table: str) -> int:
    query = sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table))
    (count,) = conn.execute(query).fetchone()  # type: ignore[misc]
    return count


def last_loaded_day(conn: psycopg.Connection, dataset: str) -> date | None:
    """The Alberta day of the newest row with an actual (not forecast) value, or None."""
    column = "pool_price" if dataset == "pool_price" else "actual_load_mw"
    query = sql.SQL("SELECT max(begin_mpt) FROM {} WHERE {} IS NOT NULL").format(
        sql.Identifier(dataset), sql.Identifier(column)
    )
    (last,) = conn.execute(query).fetchone()  # type: ignore[misc]
    return last.date() if last else None


@dataclass
class Run:
    rows_upserted: int = 0


@contextmanager
def ingestion_run(conn: psycopg.Connection, dataset: str) -> Iterator[Run]:
    """Write one ingestion_runs row around a unit of work.

    Work inside the block commits its own progress. On an exception the open transaction
    is rolled back, the run is logged as failed with the error text, and the exception is
    re-raised. On success the run is logged as ok and committed.
    """
    started = datetime.now(UTC)
    run = Run()
    try:
        yield run
    except Exception as exc:
        conn.rollback()
        _record(conn, dataset, started, run, "failed", f"{type(exc).__name__}: {exc}"[:2000])
        raise
    _record(conn, dataset, started, run, "ok", None)


def _record(
    conn: psycopg.Connection,
    dataset: str,
    started: datetime,
    run: Run,
    status: str,
    error: str | None,
) -> None:
    conn.execute(
        """
        INSERT INTO ingestion_runs
            (dataset, started_at, finished_at, rows_upserted, status, error)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (dataset, started, datetime.now(UTC), run.rows_upserted, status, error),
    )
    conn.commit()
