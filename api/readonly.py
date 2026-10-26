"""Run guarded SQL as the read-only database user, with a hard timeout and a size cap."""

from __future__ import annotations

import psycopg

from ingest.settings import require_env

QUERY_TIMEOUT_MS = 5000
MAX_RESULT_CHARS = 200_000  # the guard's LIMIT bounds the rows; this bounds their size


class ResultTooLarge(Exception):
    """The rows would be too big to show or cache."""


def run(sql: str) -> tuple[list[str], list[tuple]]:
    """Execute one guarded SELECT and return (column names, rows)."""
    options = f"-c statement_timeout={QUERY_TIMEOUT_MS} -c default_transaction_read_only=on"
    with psycopg.connect(require_env("DATABASE_URL_READONLY"), options=options) as conn:
        # A named cursor streams the rows in batches, so a huge result is cut off, not loaded.
        with conn.cursor(name="guarded") as cur:
            cur.execute(sql)
            columns = [d.name for d in cur.description or []]
            rows: list[tuple] = []
            size = 0
            for row in cur:
                size += len(str(row))
                if size > MAX_RESULT_CHARS:
                    raise ResultTooLarge
                rows.append(row)
            return columns, rows
