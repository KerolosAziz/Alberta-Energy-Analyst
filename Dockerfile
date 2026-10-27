# One image for the whole app: the built website plus the Python API that serves it.
#
#   docker build --platform linux/amd64 -t alberta-energy-analyst .
#   docker run --rm -p 8000:8000 --env-file .env alberta-energy-analyst
#
# Azure Container Apps runs linux/amd64 only, hence --platform on a Mac. The same image
# runs the one-off commands too, for example: ... alberta-energy-analyst python -m ingest.migrate
# (with DATABASE_URL pointing at a database the container can reach, not 127.0.0.1).

# 1. The website. Its output is plain files, so it builds on the machine's own platform.
FROM --platform=$BUILDPLATFORM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2. The API, with the website from step 1 in web/dist.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY router.py ./
COPY api/ api/
COPY ingest/ ingest/
COPY db/ db/
COPY evals/score.json evals/score.json
COPY --from=web /web/dist web/dist

RUN useradd --create-home --uid 10001 app
USER app

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
