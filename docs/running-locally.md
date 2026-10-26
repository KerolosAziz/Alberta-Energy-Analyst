# Running it locally

Everything runs on one machine: PostgreSQL in Docker, the Python API, and the website.

## Once

1. Install Docker Desktop, [uv](https://docs.astral.sh/uv/) and Node 20 or newer.
2. Copy `.env.example` to `.env` (`cp .env.example .env`) and fill in the two keys and a salt:

   ```
   AESO_PRIMARY_API_KEY=...        # free, from https://developer-apim.aeso.ca/
   GEMINI_API_KEY=...              # free, from https://aistudio.google.com/apikey
   IP_SALT=...                     # any random string, e.g. the output of: openssl rand -hex 16
   DATABASE_URL=postgresql://aea:aea@127.0.0.1:5432/aea
   DATABASE_URL_READONLY=postgresql://app_readonly:app_readonly@127.0.0.1:5432/aea
   ```

   The first database password is the one `docker-compose.yml` sets for the local database.
   The second is whatever you write: `ingest.migrate` gives the read-only role the password in
   `DATABASE_URL_READONLY`, so none is in the repo, and a hosted database should get a strong
   one. Never commit `.env`; it is in `.gitignore`.

3. Start the database, create the tables, load the history (about two minutes):

   ```
   docker compose up -d db
   uv sync
   uv run --env-file .env python -m ingest.migrate
   uv run --env-file .env python -m ingest.backfill --from 2000-01-01
   ```

4. Build the website once:

   ```
   cd web && npm ci && npm run build && cd ..
   ```

## Every time

```
docker compose up -d db
uv run --env-file .env uvicorn api.main:app
```

Open http://localhost:8000. The Info page is at `/`, the Ask page at `/ask`. The API is under
`/api` (for example `/api/health`).

The API keeps the data fresh by itself: it pulls new hours from the AESO when it starts and at
5 past every hour while it runs, and fills any gap left while the machine was off (up to 360
days; older than that needs `ingest.backfill`). To pull without the API running:

```
uv run --env-file .env python -m ingest.run          # once
uv run --env-file .env python -m ingest.run --loop   # every hour
```

## Working on the website

For live reload, run the API as above and, in `web/`, `npm run dev`. The dev server on
http://localhost:5173 forwards `/api` to the API.

## Optional settings

All read from `.env`.

| Variable | Default | What it does |
|---|---|---|
| `GEMINI_MODELS` | `gemini-3.8-flash,gemini-3.5-flash,gemini-3.6-flash` | Models tried in order. Each free-tier model has its own daily quota. |
| `RATE_LIMIT_PER_DAY` | `10` | Free questions per visitor per day. |
| `IP_SALT` | random at each start | Salt for the hashed visitor addresses in `rate_limits`. Without it the daily counts reset at every restart, and the API logs a warning at start. |
| `REPO_URL` | unset | When set, the pages link to the source code. |
| `CORS_ORIGINS` | the Vite dev origins | Browser origins allowed to call the API. |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy (every hosting service has one, Azure Container Apps included): the visitor's address is then the last entry of `X-Forwarded-For`, the one the proxy added. Without it, behind a proxy, every visitor shares one daily count. Never set it without a proxy, or visitors could pick their own address. |

## Optional commands

- Precompute the example answers so they show instantly: `uv run --env-file .env python -m api.precompute`
- Score the model on the question set: `uv run --env-file .env python -m evals.run`, then add a line to `evals/history.md`.

## Limits to know

- The Gemini free tier allows only a small number of requests a day per model (20 when this
  was written). The API rotates through several model names and caches every answer.
  Visitors get `RATE_LIMIT_PER_DAY` questions a day and can enter their own Gemini key on the
  Ask page to go past that; the key stays in their browser and is sent only with their questions.
- The AESO API has no published rate limit but can be slow or flaky; the loader retries.
- Visitor questions and the SQL that answered them are kept in `query_log`; visitor addresses
  are kept only as salted hashes, and only for the current day.
