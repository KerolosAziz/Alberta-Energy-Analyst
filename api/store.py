"""The app's own tables: answer cache, query log, rate limits. Read-write connection."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import psycopg

from api.answer import Answer

CACHEABLE = {"answered", "refused", "empty"}  # deterministic outcomes worth keeping
# Visitor addresses are stored only as a salted hash, so the table cannot be turned back into
# addresses. When IP_SALT is unset the salt changes on every start and the day's counts reset.
IP_SALT = os.environ.get("IP_SALT") or secrets.token_hex(16)


def normalize_question(question: str) -> str:
    return re.sub(r"\s+", " ", question.strip().lower()).rstrip("?.! ")


def cache_key(question: str, data_through: datetime) -> str:
    raw = f"{normalize_question(question)}|{data_through:%Y-%m-%d %H:%M}"
    return hashlib.sha256(raw.encode()).hexdigest()


def ip_hash(ip: str) -> str:
    return hashlib.sha256(f"{IP_SALT}:{ip}".encode()).hexdigest()[:32]


def jsonable(value: object) -> object:
    """A value PostgreSQL returned, as something json.dumps accepts."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, list):
        return [jsonable(v) for v in value]
    if value is None or isinstance(value, bool | int | float | str):
        return value
    return str(value)  # interval, time, bytes, ranges: shown as text rather than failing


def rows_json(rows: list[tuple]) -> list[list[object]]:
    return [[jsonable(v) for v in row] for row in rows]


# --- cache -------------------------------------------------------------------------------

SELECT_ANSWER = """
SELECT id, question, sql, columns, rows, answer, chart_hint, outcome, provider
FROM answer_cache
"""


def _to_answer(row: tuple) -> tuple[str, Answer]:
    id_, question, sql, columns, rows, text, chart, outcome, provider = row
    return id_, Answer(
        question=question,
        outcome=outcome,
        text=text or "",
        sql=sql,
        columns=columns or [],
        rows=[tuple(r) for r in (rows or [])],
        chart=chart,
        provider=provider,
    )


def get_cached(conn: psycopg.Connection, key: str) -> tuple[str, Answer] | None:
    row = conn.execute(SELECT_ANSWER + "WHERE cache_key = %s", (key,)).fetchone()
    return _to_answer(row) if row else None


def get_by_id(conn: psycopg.Connection, id_: str) -> tuple[str, Answer] | None:
    row = conn.execute(SELECT_ANSWER + "WHERE id = %s", (id_,)).fetchone()
    return _to_answer(row) if row else None


def get_latest_for_question(conn: psycopg.Connection, question: str) -> tuple[str, Answer] | None:
    """The newest answered row for a question, whatever data hour it was keyed on. Refused and
    empty outcomes are cached too, but one of those must never replace an example on the page."""
    row = conn.execute(
        SELECT_ANSWER + "WHERE lower(question) = lower(%s) AND outcome = 'answered' "
        "ORDER BY created_at DESC LIMIT 1",
        (question.strip(),),
    ).fetchone()
    return _to_answer(row) if row else None


def put_cache(conn: psycopg.Connection, key: str, result: Answer) -> str:
    """Store an answer and return its short id. Replaces an entry with the same key."""
    (id_,) = conn.execute(
        """
        INSERT INTO answer_cache
            (cache_key, id, question, sql, columns, rows, answer, chart_hint, outcome, provider)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (cache_key) DO UPDATE SET
            sql = EXCLUDED.sql, columns = EXCLUDED.columns, rows = EXCLUDED.rows,
            answer = EXCLUDED.answer, chart_hint = EXCLUDED.chart_hint,
            outcome = EXCLUDED.outcome, provider = EXCLUDED.provider, created_at = now()
        RETURNING id
        """,
        (
            key,
            secrets.token_urlsafe(6),  # kept only when the key is new
            result.question.strip(),
            result.sql,
            json.dumps(result.columns),
            json.dumps(rows_json(result.rows)),
            result.text,
            result.chart,
            result.outcome,
            result.provider,
        ),
    ).fetchone()
    conn.commit()
    return id_


# --- log and rate limit ------------------------------------------------------------------


def log_query(conn: psycopg.Connection, result: Answer, *, cached: bool, outcome: str) -> None:
    conn.execute(
        """
        INSERT INTO query_log (question, sql, provider, latency_ms, outcome, cached)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (result.question, result.sql, result.provider, result.latency_ms, outcome, cached),
    )
    conn.commit()


def over_limit(conn: psycopg.Connection, ip_hashed: str, limit: int, today: date) -> bool:
    """Count one more question for this visitor today; True when they are past the limit."""
    conn.execute("DELETE FROM rate_limits WHERE day < %s", (today,))  # keep only today
    (count,) = conn.execute(
        """
        INSERT INTO rate_limits (ip_hash, day, count) VALUES (%s, %s, 1)
        ON CONFLICT (ip_hash, day) DO UPDATE SET count = rate_limits.count + 1
        RETURNING count
        """,
        (ip_hashed, today),
    ).fetchone()
    conn.commit()
    return count > limit


def refund(conn: psycopg.Connection, ip_hashed: str, today: date) -> None:
    """Give one question back, for when the failure was ours, not the visitor's."""
    conn.execute(
        "UPDATE rate_limits SET count = greatest(count - 1, 0) WHERE ip_hash = %s AND day = %s",
        (ip_hashed, today),
    )
    conn.commit()


# --- what the pages show ------------------------------------------------------------------


def market(conn: psycopg.Connection) -> dict:
    """The latest hour with both a settled price and demand, the week of prices up to it, how
    many hours behind the clock it is, and a few facts."""
    latest = conn.execute(
        """
        SELECT p.begin_utc, p.begin_mpt, p.pool_price, l.actual_load_mw
        FROM pool_price p JOIN system_load l USING (begin_utc)
        WHERE p.pool_price IS NOT NULL AND l.actual_load_mw IS NOT NULL
        ORDER BY p.begin_utc DESC LIMIT 1
        """
    ).fetchone()
    record = conn.execute(
        "SELECT begin_mpt, actual_load_mw FROM system_load WHERE actual_load_mw IS NOT NULL "
        "ORDER BY actual_load_mw DESC, begin_utc LIMIT 1"
    ).fetchone()
    since, hours = conn.execute(
        "SELECT min(begin_mpt)::date, count(*) FROM pool_price WHERE pool_price IS NOT NULL"
    ).fetchone()
    week, year_avg, behind, price, load = [], None, None, None, None
    if latest:
        at_utc, at_mpt, price_value, load_value = latest
        price, load = _point((at_mpt, price_value)), _point((at_mpt, load_value))
        # An hour settles when it ends, so a job that runs every hour keeps this at 0 or 1.
        behind = int((datetime.now(UTC) - at_utc - timedelta(hours=1)) / timedelta(hours=1))
        week = conn.execute(
            "SELECT begin_mpt, pool_price FROM pool_price WHERE pool_price IS NOT NULL "
            "AND begin_utc > %s - interval '7 days' AND begin_utc <= %s ORDER BY begin_utc",
            (at_utc, at_utc),
        ).fetchall()
        (year_avg,) = conn.execute(
            "SELECT round(avg(pool_price), 2) FROM pool_price "
            "WHERE begin_mpt > %s - interval '1 year' AND begin_mpt <= %s",
            (at_mpt, at_mpt),
        ).fetchone()
    return {
        "price": price,
        "load": load,
        "hours_behind": behind,
        "record_load": _point(record),
        "week": rows_json(week),
        "since": jsonable(since),
        "hours": hours,
        "year_avg_price": jsonable(year_avg),
    }


def _point(row: tuple | None) -> dict | None:
    return {"as_of": jsonable(row[0]), "value": jsonable(row[1])} if row else None
