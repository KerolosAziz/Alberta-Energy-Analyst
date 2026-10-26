"""Score the model against the hand-written question set.

    uv run --env-file .env python -m evals.run                 # all questions
    uv run --env-file .env python -m evals.run --ids q001,q022 # a few
    uv run --env-file .env python -m evals.run --level hard    # one level

For each question the gold SQL and the model's SQL both run against the same database, and
the result rows are compared: order ignored unless the question is tagged `ranking` or
`top-n`, column names ignored, numbers within a small tolerance. Traps pass when the model
refuses (or, for the write trap, when the guard rejects). Every failure gets a label.
Record each run in evals/history.md: change one thing at a time.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import yaml

from api.answer import Answer, answer, make_router
from api.prompt import PROMPT_VERSION
from api.readonly import run
from ingest.settings import setup_logging

QUESTIONS = Path(__file__).with_name("questions.yaml")
SCORE_FILE = Path(__file__).with_name("score.json")
ORDERED_TAGS = {"ranking", "top-n"}
PAUSE_SECONDS = 2.0  # between questions, to stay well inside the free tier


def load_questions(ids: set[str] | None, level: str | None) -> list[dict]:
    questions = yaml.safe_load(QUESTIONS.read_text())
    if ids:
        questions = [q for q in questions if q["id"] in ids]
    if level:
        questions = [q for q in questions if q["level"] == level]
    return questions


# --- comparing results -------------------------------------------------------------------


def normalize(value: object) -> object:
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, int | float | Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return re.sub(r"[^a-z0-9]", "", str(value).lower())  # "Under 9,000 MW" -> "under9000mw"


def close(a: object, b: object) -> bool:
    """Numbers within a small tolerance; labels equal or one contained in the other."""
    if isinstance(a, float) and isinstance(b, float):
        # Allows gold rounded to one decimal against a model value rounded to two.
        return abs(a - b) <= max(0.06, 0.001 * abs(a))
    if isinstance(a, str) and isinstance(b, str):
        return a == b or (len(a) >= 3 and len(b) >= 3 and (a in b or b in a))
    return False


def row_matches(gold_row: tuple, got_row: tuple) -> bool:
    """Same cells in any column order: every gold cell pairs with one unused model cell."""
    unused = list(got_row)
    for cell in gold_row:
        for i, other in enumerate(unused):
            if close(cell, other):
                del unused[i]
                break
        else:
            return False
    return True


def rows_match(gold: list[tuple], got: list[tuple], ordered: bool) -> str | None:
    """None when the rows agree, else a failure label."""
    if not got:
        return "empty"
    if len(gold[0]) != len(got[0]):
        return "wrong shape"
    if len(gold) != len(got):
        return "wrong filter"
    g = [tuple(normalize(v) for v in row) for row in gold]
    m = [tuple(normalize(v) for v in row) for row in got]
    if ordered:
        return None if all(row_matches(a, b) for a, b in zip(g, m, strict=True)) else "wrong values"
    unused = list(m)
    for row in g:
        for i, candidate in enumerate(unused):
            if row_matches(row, candidate):
                del unused[i]
                break
        else:
            return "wrong values"
    return None


def label_failure(q: dict, result: Answer, gold_rows: list[tuple] | None) -> str | None:
    """None when the question passed, else the failure label."""
    expect = q.get("expect")
    if expect == "refuse":
        return None if result.outcome == "refused" else "should have refused"
    if expect == "rejected":
        return None if result.outcome in ("rejected", "refused") else "should have been rejected"
    if result.outcome != "answered":
        return {"rejected": "guard rejected", "provider_error": "provider error"}.get(
            result.outcome, result.outcome.replace("_", " ")
        )
    assert gold_rows is not None
    label = rows_match(gold_rows, result.rows, ordered=bool(ORDERED_TAGS & set(q.get("tags", []))))
    if label == "wrong values" and result.sql and "begin_utc" in result.sql.split("WHERE", 1)[-1]:
        return "timezone"
    return label


# --- the run -----------------------------------------------------------------------------


def main() -> None:
    setup_logging()
    parser = argparse.ArgumentParser(description="Score the model against evals/questions.yaml.")
    parser.add_argument("--ids", help="comma-separated question ids")
    parser.add_argument("--level", choices=["easy", "medium", "hard", "trap"])
    args = parser.parse_args()

    questions = load_questions(set(args.ids.split(",")) if args.ids else None, args.level)
    router = make_router()
    results: list[tuple[dict, Answer, str | None]] = []

    for i, q in enumerate(questions, 1):
        gold_rows = run(q["gold_sql"])[1] if "gold_sql" in q else None
        result = answer(q["question"], router, summarize=False)
        if result.outcome == "provider_error":  # one more try after a breather
            time.sleep(20)
            result = answer(q["question"], router, summarize=False)
        label = label_failure(q, result, gold_rows)
        status = "ok  " if label is None else "FAIL"
        print(
            f"{status} {q['id']} [{q['level']:6}] {label or ''}  {q['question'][:70]}", flush=True
        )
        results.append((q, result, label))
        if i < len(questions):
            time.sleep(PAUSE_SECONDS)

    report(results)
    if not args.ids and not args.level:  # a full run: publish the score the page shows
        unanswered = [q["id"] for q, r, _ in results if r.outcome == "provider_error"]
        if unanswered:  # a quota or outage problem, not a score
            print(f"\nScore not written: no model answer for {', '.join(unanswered)}")
            return
        passed = sum(label is None for _, _, label in results)
        SCORE_FILE.write_text(
            json.dumps(
                {
                    "passed": passed,
                    "total": len(results),
                    "date": datetime.now(UTC).strftime("%Y-%m-%d"),
                    "prompt": PROMPT_VERSION,
                    "models": os.environ.get("GEMINI_MODELS", "default"),
                },
                indent=1,
            )
            + "\n"
        )
        print(f"\nScore written to {SCORE_FILE.name}")


def report(results: list[tuple[dict, Answer, str | None]]) -> None:
    passed = sum(label is None for _, _, label in results)
    total = len(results)
    print(f"\nRun {datetime.now(UTC):%Y-%m-%d %H:%M} UTC  prompt={PROMPT_VERSION}")
    print(f"Passed {passed}/{total} ({100 * passed / total:.1f}%)")
    by_level = {}
    for q, _, label in results:
        ok, n = by_level.get(q["level"], (0, 0))
        by_level[q["level"]] = (ok + (label is None), n + 1)
    print("  " + "   ".join(f"{lvl} {ok}/{n}" for lvl, (ok, n) in by_level.items()))
    labels: dict[str, int] = {}
    for _, _, label in results:
        if label:
            labels[label] = labels.get(label, 0) + 1
    if labels:
        print(
            "Failures: "
            + ", ".join(f"{k} {v}" for k, v in sorted(labels.items(), key=lambda kv: -kv[1]))
        )
    providers: dict[str, int] = {}
    for _, r, _ in results:
        providers[r.provider or "none"] = providers.get(r.provider or "none", 0) + 1
    print("Providers: " + ", ".join(f"{k} {v}" for k, v in providers.items()))
    failures = [(q, r, label) for q, r, label in results if label]
    if failures:
        print("\nFailed questions:")
        for q, r, label in failures:
            print(f"\n- {q['id']} ({label}): {q['question']}")
            if r.sql:
                print("  model SQL: " + " ".join(r.sql.split()))
            if r.text and r.outcome != "answered":
                print(f"  model said: {r.text[:200]}")


if __name__ == "__main__":
    main()
