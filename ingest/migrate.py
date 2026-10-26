"""Apply the SQL files in db/ in name order, each once.

    uv run --env-file .env python -m ingest.migrate

Applied file names are kept in schema_migrations. Each file runs in its own transaction.
Afterwards the read-only role gets the password in DATABASE_URL_READONLY, so no password
sits in db/ and a hosted database gets its own.
"""

from __future__ import annotations

import logging
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

from ingest.db import connect
from ingest.settings import require_env, setup_logging

log = logging.getLogger(__name__)

DB_DIR = Path(__file__).resolve().parent.parent / "db"


def migrate(conn: psycopg.Connection) -> list[str]:
    """Apply every migration not yet applied. Returns the names applied, in order."""
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name        text        PRIMARY KEY,
                applied_at  timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        conn.commit()
        cur.execute("SELECT name FROM schema_migrations")
        done = {name for (name,) in cur.fetchall()}
        applied: list[str] = []
        for path in sorted(DB_DIR.glob("*.sql")):
            if path.name in done:
                continue
            cur.execute(path.read_text())
            cur.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
            conn.commit()
            applied.append(path.name)
            log.info("applied %s", path.name)
    return applied


def set_readonly_password(conn: psycopg.Connection) -> None:
    """Give the read-only role the password in DATABASE_URL_READONLY (db/002 creates it with
    none). Runs every time, so changing the URL changes the password."""
    info = conninfo_to_dict(require_env("DATABASE_URL_READONLY"))
    if not info.get("password"):
        log.warning("DATABASE_URL_READONLY has no password; the read-only role keeps its own")
        return
    conn.execute(
        sql.SQL("ALTER ROLE {} PASSWORD {}").format(
            sql.Identifier(info["user"]), sql.Literal(info["password"])
        )
    )
    conn.commit()
    log.info("password of %s set from DATABASE_URL_READONLY", info["user"])


def main() -> None:
    setup_logging()
    with connect() as conn:
        applied = migrate(conn)
        set_readonly_password(conn)
    log.info("%d migration(s) applied", len(applied))


if __name__ == "__main__":
    main()
