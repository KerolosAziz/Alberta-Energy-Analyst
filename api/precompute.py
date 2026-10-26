"""The example questions, and the command that answers and caches them so the page shows them free.

    uv run --env-file .env python -m api.precompute

Run it after loading data and whenever the examples change. Safe to re-run.
"""

from __future__ import annotations

import logging

from api import store
from api.answer import answer, data_range, make_router
from ingest.db import connect
from ingest.settings import setup_logging

log = logging.getLogger(__name__)

# Shown on the pages with their precomputed answers. None of these are in evals/questions.yaml.
EXAMPLE_QUESTIONS = [
    "Which month of 2025 had the highest average demand?",
    "How many hours in 2024 was the pool price above $500?",
    "What was the average pool price in each month of 2026?",
    "What was the peak demand in each year since 2015?",
    "On which day in 2025 was the average pool price highest?",
    "How did average demand in July 2026 compare with July 2016?",
]


def main() -> None:
    setup_logging()
    router = make_router()
    with connect() as conn:
        for question in EXAMPLE_QUESTIONS:
            result = answer(question, router)
            if result.outcome in store.CACHEABLE:
                id_ = store.put_cache(conn, store.cache_key(question, data_range()[1]), result)
                log.info("%s  [%s] %s", id_, result.outcome, question)
            else:
                log.warning("not cached [%s] %s: %s", result.outcome, question, result.text)


if __name__ == "__main__":
    main()
