"""Data pipeline: pull AESO market data into PostgreSQL.

Commands (run from the repo root, with the .env loaded by uv):

    uv run --env-file .env python -m ingest.migrate
    uv run --env-file .env python -m ingest.backfill --from 2000-01-01
    uv run --env-file .env python -m ingest.run
"""
