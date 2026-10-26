"""Load history from the AESO API, one calendar year per call, for both datasets.

    uv run --env-file .env python -m ingest.backfill --from 2000-01-01
    uv run --env-file .env python -m ingest.backfill --from 2026-01-01 --to 2026-06-30

Re-running is safe: rows are upserted on their UTC hour. Each year is committed as it
lands, so an interrupted backfill keeps what it already loaded.
"""

from __future__ import annotations

import argparse
import logging
import time
from collections.abc import Iterator
from datetime import date

from ingest.aeso import DATASETS, AesoClient, alberta_today
from ingest.db import connect, count_rows, ingestion_run, upsert
from ingest.settings import require_env, setup_logging

log = logging.getLogger(__name__)

PAUSE_SECONDS = 0.5  # between API calls; the AESO publishes no rate limit, so be polite


def year_chunks(start: date, end: date) -> Iterator[tuple[date, date]]:
    """Split ``start..end`` into pieces that never cross a calendar year (so never > 366 days)."""
    year = start.year
    while True:
        chunk_start = max(start, date(year, 1, 1))
        if chunk_start > end:
            return
        yield chunk_start, min(end, date(year, 12, 31))
        year += 1


def main() -> None:
    setup_logging()
    parser = argparse.ArgumentParser(description="Load AESO history year by year.")
    parser.add_argument("--from", dest="start", type=date.fromisoformat, required=True)
    parser.add_argument("--to", dest="end", type=date.fromisoformat, default=alberta_today())
    args = parser.parse_args()

    client = AesoClient(require_env("AESO_PRIMARY_API_KEY"))
    with connect() as conn:
        for dataset in DATASETS:
            with ingestion_run(conn, dataset) as run:
                for start, end in year_chunks(args.start, args.end):
                    written = upsert(conn, dataset, client.fetch(dataset, start, end))
                    run.rows_upserted += written
                    log.info("%s %s..%s: %d rows", dataset, start, end, written)
                    time.sleep(PAUSE_SECONDS)
            log.info(
                "%s done: %d rows upserted, %d in table",
                dataset,
                run.rows_upserted,
                count_rows(conn, dataset),
            )


if __name__ == "__main__":
    main()
