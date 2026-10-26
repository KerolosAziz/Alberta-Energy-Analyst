"""Answer one question end to end: prompt, model, guard, run, summarize, chart hint.

``stages()`` yields the answer as it takes shape ("sql", then "rows", then "done"), which is
what the streaming endpoint sends to the page. ``answer()`` just runs it to the end.
"""

from __future__ import annotations

import logging
import os
import re
import time
from collections.abc import Generator, Iterator
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

import psycopg

from api.guard import GuardError, guard
from api.prompt import build_prompt, build_repair_prompt, build_summary_prompt
from api.readonly import ResultTooLarge, run
from ingest.aeso import alberta_today
from ingest.settings import require_env
from router import AllProvidersFailed, Completion, GeminiProvider, Retry, Router

log = logging.getLogger(__name__)

DEFAULT_MODELS = "gemini-3.8-flash,gemini-3.5-flash,gemini-3.6-flash"
SQL_BLOCK = re.compile(r"```(?:sql)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
UNAVAILABLE = "The model is not available right now. Please try again in a minute."
BAD_KEY = "That Gemini API key was not accepted. Check it, or remove it to use the free allowance."
TOO_MUCH = "too much"  # what execute() returns when the database cut the query off
SUMMARY_SECONDS = 10  # past this the page gets a plain sentence instead of the model's


@dataclass
class Answer:
    question: str
    outcome: str  # answered | refused | rejected | timeout | sql_error | empty | provider_error
    text: str = ""
    sql: str | None = None
    columns: list[str] = field(default_factory=list)
    rows: list[tuple] = field(default_factory=list)
    chart: str | None = None
    provider: str | None = None
    latency_ms: int = 0
    note: str = ""  # what the page shows while waiting, e.g. that a model is busy


def make_router(api_key: str | None = None) -> Router:
    """The router the app uses: newest model first, older ones as fallback."""
    key = api_key or require_env("GEMINI_API_KEY")
    models = [
        m.strip() for m in os.environ.get("GEMINI_MODELS", DEFAULT_MODELS).split(",") if m.strip()
    ]
    # Gemini answers 503 "high demand" in bursts; a short timeout moves on to the next model
    # rather than leaving the visitor waiting on a stuck one.
    return Router(
        [GeminiProvider(key, m) for m in models], retries=2, timeout=15.0, backoff_seconds=3.0
    )


def data_range() -> tuple[datetime, datetime]:
    """The first and last settled hours. The model sees both; the last one keys the cache."""
    _, rows = run(
        "SELECT min(begin_mpt), max(begin_mpt) FROM pool_price WHERE pool_price IS NOT NULL"
    )
    return rows[0]


def answer(
    question: str, router: Router, *, today: date | None = None, summarize: bool = True
) -> Answer:
    """Run every stage and return the finished answer."""
    return list(stages(question, router, today=today, summarize=summarize))[-1][1]


def stages(
    question: str, router: Router, *, today: date | None = None, summarize: bool = True
) -> Iterator[tuple[str, Answer]]:
    """Yield ("sql", a) and ("rows", a) as they become known, and always ("done", a) last.

    ("status", a) comes each time a model call fails and another starts; ``a.note`` says which.

    ``summarize=False`` skips the model call that writes the sentence for multi-row results;
    the evaluation harness uses it because scoring only needs the rows.
    """
    started = time.monotonic()
    result = Answer(question=question, outcome="provider_error", text=UNAVAILABLE)
    try:
        yield from _stages(result, router, today or alberta_today(), summarize)
    except AllProvidersFailed as exc:
        log.warning("all providers failed: %s", exc)
        result.outcome = "provider_error"
        bad_key = all("API key" in err or "API_KEY" in err for err in exc.errors.values())
        result.text = BAD_KEY if bad_key else UNAVAILABLE
    result.latency_ms = int((time.monotonic() - started) * 1000)
    yield "done", result


def _stages(
    result: Answer, router: Router, today: date, summarize: bool
) -> Iterator[tuple[str, Answer]]:
    since, through = data_range()
    prompt = build_prompt(result.question, today=today, data_since=since, data_through=through)
    completion = yield from ask_model(router, prompt, result)
    result.provider = completion.provider
    reply = completion.text.strip()

    if reply.upper().startswith("CANNOT_ANSWER"):
        reason = reply.split(":", 1)[1].strip()[:200] if ":" in reply else ""
        result.outcome = "refused"
        result.text = f"I can't answer that from the data I have. {reason[:1].upper()}{reason[1:]}"
        return

    try:
        result.sql = guard(extract_sql(reply))
    except GuardError as exc:
        result.sql = extract_sql(reply)
        result.outcome, result.text = "rejected", f"That query was not allowed: {exc}."
        return
    yield "sql", result

    error = execute(result)
    if error and error != TOO_MUCH:
        # One repair attempt: show the model its own SQL and the database's error.
        repair = yield from ask_model(
            router, build_repair_prompt(prompt, result.sql, error), result
        )
        try:
            result.sql = guard(extract_sql(repair.text.strip()))
        except GuardError as exc:
            log.warning("repair rejected (%s): %r", exc, repair.text[:300])
        else:
            yield "sql", result
            error = execute(result)
    if error == TOO_MUCH:
        result.outcome = "timeout"
        result.text = "That query took too long or returned too much. Try a narrower date range."
        return
    if error:
        result.outcome, result.text = "sql_error", f"The query failed: {error}"
        return
    if not result.rows:
        result.outcome, result.text = "empty", "The query ran but returned no rows."
        return

    result.outcome = "answered"
    result.chart = chart_hint(result.columns, result.rows)
    yield "rows", result
    if result.chart == "stat":  # one value: a template, no second model call
        result.text = f"{result.columns[0].replace('_', ' ')}: {result.rows[0][0]}"
    elif summarize:
        yield from summarize_rows(router, result)


def execute(result: Answer) -> str | None:
    """Run result.sql into result.columns and rows. Returns None, TOO_MUCH, or the error text."""
    try:
        result.columns, result.rows = run(result.sql or "")
        return None
    except (psycopg.errors.QueryCanceled, ResultTooLarge):
        return TOO_MUCH
    except psycopg.Error as exc:
        return str(exc).strip().splitlines()[0][:200]


def ask_model(
    router: Router, prompt: str, result: Answer, *, within: float | None = None
) -> Generator[tuple[str, Answer], None, Completion]:
    """Call the model, yielding ("status", result) with a note each time a call fails."""
    for event in router.attempts(prompt, within=within):  # ends with the Completion or raises
        if isinstance(event, Completion):
            return event
        result.note = retry_note(event)
        yield "status", result


def retry_note(retry: Retry) -> str:
    """ "gemini-3.8-flash did not answer (HTTP 503), trying gemini-3.5-flash"."""
    failed, following = (name.removeprefix("gemini:") for name in (retry.failed, retry.next))
    reason = "timed out" if "Timeout" in retry.error else retry.error.split(":", 1)[0]
    then = "trying again" if retry.next == retry.failed else f"trying {following}"
    return f"{failed} did not answer ({reason}), {then}"


def summarize_rows(router: Router, result: Answer) -> Iterator[tuple[str, Answer]]:
    """Set result.text to one or two sentences from the model, or, when it is unavailable or
    slower than SUMMARY_SECONDS, a plain highs-and-lows sentence (the chart says the rest)."""
    prompt = build_summary_prompt(result.question, result.columns, result.rows)
    try:
        completion = yield from ask_model(router, prompt, result, within=SUMMARY_SECONDS)
        result.text = completion.text.strip()
    except AllProvidersFailed as exc:
        log.warning("summary call failed: %s", exc)
        result.text = highs_and_lows(result)


def highs_and_lows(result: Answer) -> str:
    """ "Highest avg price: 99.30 (2025-12). Lowest: 42.10 (2025-05)." for a line or bar."""
    points = [row for row in result.rows if row[1] is not None]
    if result.chart not in ("line", "bar") or not points:
        return ""
    high, low = max(points, key=lambda r: r[1]), min(points, key=lambda r: r[1])
    name = result.columns[1].replace("_", " ")
    return (
        f"Highest {name}: {_num(high[1])} ({_label(high[0])}). "
        f"Lowest: {_num(low[1])} ({_label(low[0])})."
    )


def _num(value: int | float | Decimal) -> str:
    return f"{value:,.0f}" if value == int(value) else f"{value:,.2f}"


def _label(value: object) -> str:
    return f"{value:%Y-%m-%d %H:%M}" if isinstance(value, datetime) else str(value)


def extract_sql(reply: str) -> str:
    match = SQL_BLOCK.search(reply)
    return (match.group(1) if match else reply).strip()


def chart_hint(columns: list[str], rows: list[tuple]) -> str:
    """One value: stat. Time plus a number: line. Category plus a number: bar. Else: table."""
    if len(rows) == 1 and len(columns) == 1:
        return "stat"
    if len(columns) == 2:
        first, second = rows[0]
        if isinstance(second, int | float | Decimal):
            if isinstance(first, datetime | date):
                return "line"
            if isinstance(first, str | int):
                return "bar"
    return "table"
