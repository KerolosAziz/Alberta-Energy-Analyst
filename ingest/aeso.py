"""Client for the AESO public API.

Only the two hourly reports v1 loads: pool price, and Alberta internal load (actual and
forecast). Everything observed about the API is in docs/aeso-data.md. The short version:

- auth is the ``API-KEY`` header;
- ``startDate`` and ``endDate`` are ``yyyy-MM-dd`` Alberta calendar days, inclusive, at most
  366 days apart;
- every number arrives as a string, and an unknown value as ``""``;
- timestamps are ``"YYYY-MM-DD HH:MM"``, once in UTC and once on the Alberta clock (MPT),
  stamped with the hour beginning. The MPT hour repeats each November, so UTC is the key.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import httpx

log = logging.getLogger(__name__)

BASE_URL = "https://apimgw.aeso.ca/public/"
# dataset -> (report path, value fields in the order the table's upsert expects them)
REPORTS = {
    "pool_price": (
        "poolprice-api/v1.1/price/poolPrice",
        ("pool_price", "forecast_pool_price", "rolling_30day_avg"),
    ),
    "system_load": (
        "actualforecast-api/v1/load/albertaInternalLoad",
        ("alberta_internal_load", "forecast_alberta_internal_load"),
    ),
}
DATASETS = tuple(REPORTS)
TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M"
ALBERTA = ZoneInfo("America/Edmonton")
RETRIES = 3
BACKOFF_SECONDS = 2.0


class AesoError(Exception):
    """The API answered with an error, or with a shape we do not understand."""


def alberta_today() -> date:
    """The API's calendar days are Alberta local days."""
    return datetime.now(ALBERTA).date()


def parse_number(value: str | None) -> Decimal | None:
    return None if value is None or value == "" else Decimal(value)


def parse_rows(payload: Any, fields: tuple[str, ...]) -> list[tuple]:
    """Rows as ``(begin_utc, begin_mpt, *values)`` from ``{"return": {"<Report>": [rows]}}``."""
    body = payload.get("return") if isinstance(payload, dict) else None
    rows = next(iter(body.values())) if isinstance(body, dict) and len(body) == 1 else None
    if not isinstance(rows, list):
        raise AesoError(f"unexpected response shape: {str(payload)[:200]}")
    return [
        (
            datetime.strptime(r["begin_datetime_utc"], TIMESTAMP_FORMAT).replace(tzinfo=UTC),
            datetime.strptime(r["begin_datetime_mpt"], TIMESTAMP_FORMAT),  # naive: Alberta clock
            *(parse_number(r.get(f)) for f in fields),
        )
        for r in rows
    ]


class AesoClient:
    """Thin HTTP client. Retries transport errors and 5xx answers; 4xx answers are final."""

    def __init__(self, api_key: str) -> None:
        self._client = httpx.Client(base_url=BASE_URL, headers={"API-KEY": api_key}, timeout=60.0)

    def fetch(self, dataset: str, start: date, end: date) -> list[tuple]:
        """One report call for ``start..end`` (inclusive Alberta days), parsed into rows."""
        path, fields = REPORTS[dataset]
        params = {"startDate": start.isoformat(), "endDate": end.isoformat()}
        problem = ""
        for attempt in range(1, RETRIES + 1):
            try:
                response = self._client.get(path, params=params)
            except httpx.TransportError as exc:
                problem = f"{type(exc).__name__}: {exc}"
            else:
                if response.status_code == 200:
                    return parse_rows(response.json(), fields)
                if response.status_code < 500:
                    raise AesoError(
                        f"{path} {start}..{end}: HTTP {response.status_code} {response.text[:200]}"
                    )
                problem = f"HTTP {response.status_code}"
            if attempt < RETRIES:
                wait = BACKOFF_SECONDS * attempt
                log.warning(
                    "%s %s..%s failed (%s); retrying in %.0fs", path, start, end, problem, wait
                )
                time.sleep(wait)
        raise AesoError(f"{path} {start}..{end}: gave up after {RETRIES} tries ({problem})")
