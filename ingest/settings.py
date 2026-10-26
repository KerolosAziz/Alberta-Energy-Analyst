"""Environment variables and logging for the commands."""

import logging
import os


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(
            f"{name} is not set. Add it to .env and run with: uv run --env-file .env python -m ..."
        )
    return value


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # otherwise one line per request
    logging.getLogger("sqlglot").setLevel(logging.ERROR)  # it warns about SQL it still parses
