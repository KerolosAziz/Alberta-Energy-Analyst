"""The HTTP API, and the website once it has been built.

    uv run --env-file .env uvicorn api.main:app --reload

Everything the page calls lives under /api: POST /api/ask streams the answer as server-sent
events (status while a model is retried, sql, rows, answer, done, or error); GET /api/site
has what the pages show at load; GET /api/a/{id} is a saved answer; GET /api/health is a check.
When web/dist exists (``cd web && npm run build``) the same process serves the site at /
(Info), /ask and /a/{id}, so one command runs the whole thing locally. While it runs, it also
pulls new AESO data at start and at 5 past every hour (``ingest.run.loop``).
"""

from __future__ import annotations

import json
import logging
import os
import threading
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

import psycopg
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from api import store
from api.answer import Answer, data_range, make_router, stages
from api.precompute import EXAMPLE_QUESTIONS
from ingest.aeso import alberta_today
from ingest.db import connect
from ingest.run import loop as pull_every_hour
from ingest.settings import setup_logging
from router import Router

setup_logging()
log = logging.getLogger(__name__)

RATE_LIMIT_PER_DAY = int(os.environ.get("RATE_LIMIT_PER_DAY", "10"))
# Set TRUST_PROXY=1 behind a reverse proxy (every hosting service puts one in front, Azure
# Container Apps included): the visitor's address is then the last entry of X-Forwarded-For,
# the one the proxy itself added. Without it, behind a proxy, every visitor shares the proxy's
# address and one daily count. Never set it without a proxy: the header is then the visitor's own.
TRUST_PROXY = os.environ.get("TRUST_PROXY", "") == "1"
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
REPO_URL = os.environ.get("REPO_URL")  # the pages link to the source when this is set
ROOT = Path(__file__).resolve().parent.parent
SCORE_FILE = ROOT / "evals" / "score.json"
WEB_DIST = ROOT / "web" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if not os.environ.get("IP_SALT"):
        log.warning("IP_SALT is not set: the daily question counts reset at every restart")
    # Keep the data current for as long as the site is up; a daemon thread ends with the process.
    threading.Thread(target=pull_every_hour, name="ingest", daemon=True).start()
    yield


app = FastAPI(title="Alberta Energy Analyst", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS.split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Gemini-Key"],
)
api = APIRouter(prefix="/api")


class Ask(BaseModel):
    question: str = Field(min_length=3, max_length=500)


@lru_cache(maxsize=1)
def shared_router() -> Router:
    return make_router()


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def rows_payload(result: Answer) -> dict:
    return {"columns": result.columns, "rows": store.rows_json(result.rows), "chart": result.chart}


def client_ip(request: Request) -> str:
    # A proxy appends the address it saw to whatever the visitor sent, so only the last entry
    # is the proxy's own; the ones before it can say anything.
    forwarded = request.headers.get("x-forwarded-for") if TRUST_PROXY else None
    if forwarded:
        return forwarded.rsplit(",", 1)[-1].strip()
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def security_headers(request: Request, call_next):  # noqa: ANN001, ANN202
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return response


def event_stream(question: str, request: Request) -> Iterator[str]:
    # The 200 and its headers are already sent when this runs, so a failure can only reach the
    # page as an error event; without one the stream just ends and the page waits forever.
    try:
        yield from answer_events(question, request)
    except psycopg.OperationalError:
        log.exception("database unavailable")
        yield sse("error", {"reason": "database_unavailable"})
    except Exception:
        log.exception("ask failed")
        yield sse("error", {"reason": "server_error"})


def answer_events(question: str, request: Request) -> Iterator[str]:
    own_key = request.headers.get("x-gemini-key")
    with connect() as conn:
        key = store.cache_key(question, data_range()[1])
        hit = store.get_cached(conn, key)
        if hit:
            id_, result = hit
            if result.sql:
                yield sse("sql", {"sql": result.sql})
            if result.rows:
                yield sse("rows", rows_payload(result))
            yield sse("answer", {"text": result.text, "cached": True})
            yield sse("done", {"id": id_, "provider": result.provider, "latency_ms": 0})
            store.log_query(conn, result, cached=True, outcome="cached")
            return

        visitor = store.ip_hash(client_ip(request))
        if not own_key and store.over_limit(conn, visitor, RATE_LIMIT_PER_DAY, alberta_today()):
            yield sse("error", {"reason": "rate_limited", "limit": RATE_LIMIT_PER_DAY})
            store.log_query(
                conn,
                Answer(question=question, outcome="rate_limited"),
                cached=False,
                outcome="rate_limited",
            )
            return

        router = make_router(own_key) if own_key else shared_router()
        result: Answer | None = None
        for stage, result in stages(question, router):
            if stage == "status":
                yield sse("status", {"message": result.note})
            elif stage == "sql":
                yield sse("sql", {"sql": result.sql})
            elif stage == "rows":
                yield sse("rows", rows_payload(result))
        assert result is not None

        settled = result.outcome in store.CACHEABLE  # answered, refused or empty
        id_ = store.put_cache(conn, key, result) if settled else None
        store.log_query(conn, result, cached=False, outcome=result.outcome)
        if result.outcome == "provider_error" and not own_key:
            store.refund(conn, visitor, alberta_today())  # the model's failure is not their fault
        if settled:
            yield sse("answer", {"text": result.text, "cached": False})
            yield sse(
                "done", {"id": id_, "provider": result.provider, "latency_ms": result.latency_ms}
            )
        else:
            reason = {"provider_error": "provider_unavailable", "sql_error": "rejected"}.get(
                result.outcome, result.outcome
            )
            yield sse("error", {"reason": reason, "message": result.text, "sql": result.sql})


@api.post("/ask")
def ask(body: Ask, request: Request) -> StreamingResponse:
    return StreamingResponse(
        event_stream(body.question, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api.get("/site")
def site() -> dict:
    """What the pages show at load: the market now, the example answers, the score, the limits."""
    with connect() as conn:
        market = store.market(conn)
        examples = [example(conn, q) for q in EXAMPLE_QUESTIONS]
    score = json.loads(SCORE_FILE.read_text()) if SCORE_FILE.exists() else None
    return {
        "market": market,
        "examples": examples,
        "score": score,
        "limit": RATE_LIMIT_PER_DAY,
        "repo": REPO_URL,
    }


def example(conn: psycopg.Connection, question: str) -> dict:
    """An example question with its precomputed answer, when it has one."""
    item: dict = {"question": question, "id": None, "answer": None}
    hit = store.get_latest_for_question(conn, question)
    if hit:
        id_, result = hit
        item.update(id=id_, answer=result.text, sql=result.sql, **rows_payload(result))
    return item


@api.get("/a/{id_}")
def saved(id_: str) -> dict:
    with connect() as conn:
        hit = store.get_by_id(conn, id_)
    if not hit:
        raise HTTPException(status_code=404, detail="no such answer")
    _, result = hit
    return {
        "id": id_,
        "question": result.question,
        "sql": result.sql,
        "answer": result.text,
        "outcome": result.outcome,
        "provider": result.provider,
        **rows_payload(result),
    }


@api.get("/health")
def health() -> dict:
    return {"ok": True}


app.include_router(api)

# The built website, when present. Any path that is not a file and not /api/... gets
# index.html, so the page's own routes (/ask, /a/{id}) work on a reload.
if WEB_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def page(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = (WEB_DIST / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(WEB_DIST):
            return FileResponse(candidate)
        # Always revalidate the page itself, so a new build is seen on the next visit; the
        # assets it points to carry a hash in their name and can be cached as long as wanted.
        return FileResponse(WEB_DIST / "index.html", headers={"Cache-Control": "no-cache"})
