"""One incremental pull. Meant to run a few minutes past every hour.

    uv run --env-file .env python -m ingest.run          # once, now
    uv run --env-file .env python -m ingest.run --loop   # now, then at 5 past every hour

The API runs ``loop()`` itself while it is up, so the second form is only needed without it.

Each dataset re-pulls a trailing window and upserts it, so revised values are picked up:

- pool price: the last 2 days through tomorrow (the API carries the next hour's forecast);
- load: the last 15 days through 14 days ahead (the AESO revises its two-week forecast).

If the last loaded hour is older than that (the machine was off), the window starts there
instead, up to 360 days back; beyond that, run ingest.backfill.

A failure in one dataset is logged and the other still runs; the exit code is then 1.
"""

from __future__ import annotations

import logging
import sys
import time
from datetime import date, datetime, timedelta

import psycopg

from ingest.aeso import AesoClient, alberta_today
from ingest.db import connect, ingestion_run, last_loaded_day, upsert
from ingest.settings import require_env, setup_logging

log = logging.getLogger(__name__)

# dataset -> (days back, days ahead), inclusive Alberta calendar days around today
WINDOWS = {
    "pool_price": (2, 1),
    "system_load": (15, 14),
}


def pull_once() -> list[str]:
    """Pull both datasets. Returns the names of the ones that failed."""
    today = alberta_today()
    failed = []
    client = AesoClient(require_env("AESO_PRIMARY_API_KEY"))
    with connect() as conn:
        for dataset, (back, ahead) in WINDOWS.items():
            start, end = today - timedelta(days=back), today + timedelta(days=ahead)
            start = catch_up(conn, dataset, start, today)
            try:
                with ingestion_run(conn, dataset) as run:
                    run.rows_upserted = upsert(conn, dataset, client.fetch(dataset, start, end))
            except Exception:
                log.exception("%s %s..%s failed", dataset, start, end)
                failed.append(dataset)
            else:
                log.info("%s %s..%s: %d rows", dataset, start, end, run.rows_upserted)
    return failed


def catch_up(conn: psycopg.Connection, dataset: str, start: date, today: date) -> date:
    """Move ``start`` back to the day before the last loaded hour, at most 360 days back."""
    last = last_loaded_day(conn, dataset)
    if last is None:
        return start
    return max(min(start, last - timedelta(days=1)), today - timedelta(days=360))


def seconds_until_five_past() -> float:
    now = datetime.now()
    target = now.replace(minute=5, second=0, microsecond=0)
    if target <= now:
        target += timedelta(hours=1)
    return (target - now).total_seconds()


def loop() -> None:
    """Pull now, then at 5 past every hour, for as long as the process runs."""
    while True:  # a tiny scheduler for the local version: no cron, no extra service
        try:
            pull_once()
        except Exception:  # e.g. the database is down; the next pull catches up
            log.exception("pull failed")
        wait = seconds_until_five_past()
        log.info("next pull in %d minutes", round(wait / 60))
        time.sleep(wait)


def main() -> None:
    setup_logging()
    if "--loop" not in sys.argv:
        sys.exit(1 if pull_once() else 0)
    loop()


if __name__ == "__main__":
    main()
