"""The prompt that turns a question into SQL.

It carries the schema, a short glossary, the rules that matter most (dates on begin_mpt,
half-open ranges, NULLs), a refusal protocol for questions the data cannot answer, and a
few worked examples. The examples must never come from evals/questions.yaml.
"""

from __future__ import annotations

from datetime import date, datetime

# Bump when the prompt changes, so evals/history.md can tell runs apart.
PROMPT_VERSION = "v1"

EXAMPLES = [
    (
        "What was the average pool price on January 11, 2024?",
        "SELECT round(avg(pool_price), 2) AS avg_price\n"
        "FROM pool_price\n"
        "WHERE begin_mpt >= '2024-01-11' AND begin_mpt < '2024-01-12';",
    ),
    (
        "What was the peak demand in each year since 2015?",
        "SELECT extract(year FROM begin_mpt)::int AS year, max(actual_load_mw) AS peak_mw\n"
        "FROM system_load\n"
        "WHERE begin_mpt >= '2015-01-01' AND actual_load_mw IS NOT NULL\n"
        "GROUP BY 1\nORDER BY 1;",
    ),
    (
        "Which day of the week had the highest average price in 2024?",
        "SELECT trim(to_char(begin_mpt, 'Day')) AS weekday, round(avg(pool_price), 2) AS avg_price\n"
        "FROM pool_price\n"
        "WHERE begin_mpt >= '2024-01-01' AND begin_mpt < '2025-01-01'\n"
        "GROUP BY 1\nORDER BY 2 DESC\nLIMIT 1;",
    ),
    (
        "In January 2024, which hours had demand above 12,000 MW and a price above $900?",
        "SELECT p.begin_mpt, l.actual_load_mw, p.pool_price\n"
        "FROM pool_price p\n"
        "JOIN system_load l ON l.begin_utc = p.begin_utc\n"
        "WHERE p.begin_mpt >= '2024-01-01' AND p.begin_mpt < '2024-02-01'\n"
        "  AND l.actual_load_mw > 12000 AND p.pool_price > 900\n"
        "ORDER BY p.begin_mpt;",
    ),
    (
        "How much power did wind farms generate last month?",
        "CANNOT_ANSWER: the data has only the total price and total demand, not generation by fuel.",
    ),
]

TEMPLATE = """\
You write one PostgreSQL SELECT query that answers a question about Alberta's electricity market.

Tables (one row per hour, stamped with the hour beginning):

pool_price(begin_utc timestamptz, begin_mpt timestamp, pool_price numeric, forecast_pool_price numeric, rolling_30day_avg numeric)
  pool_price: the hourly wholesale price in $/MWh, from 0 to 999.99. NULL for the current hour and later.
  forecast_pool_price: the AESO's price forecast, available only one or two hours ahead.
  rolling_30day_avg: the average price over the previous 30 days.

system_load(begin_utc timestamptz, begin_mpt timestamp, actual_load_mw numeric, forecast_load_mw numeric)
  actual_load_mw: Alberta internal load, meaning total provincial demand, in MW. NULL for the current hour and later.
  forecast_load_mw: the AESO's demand forecast, about 14 days ahead.

The data runs from {data_since} to {data_through} (the last settled hour). Today in Alberta is {today}.

Rules:
- begin_mpt is Alberta local time. Filter dates on begin_mpt and take hours, days, months and years from begin_mpt. Never filter on begin_utc. Join the two tables on begin_utc.
- "Demand", "load" and "AIL" mean actual_load_mw. "Price" and "pool price" mean pool_price.
- Use half-open date ranges: begin_mpt >= 'YYYY-MM-DD' AND begin_mpt < 'YYYY-MM-DD'.
- Add IS NOT NULL when averaging, ranking or taking a minimum or maximum.
- Keep the result small: aggregate. When the question asks "when", include begin_mpt.
- Round average prices to 2 decimals and average MW to whole numbers.
- Write exactly one SELECT. No comments, no explanations, no DDL, no DML.
- If the two tables cannot answer the question, reply with exactly one line:
  CANNOT_ANSWER: <one short reason>
  This applies to the future beyond the forecast columns, to generation or fuel types, to specific customers such as data centres, and to anything that is not price or demand.

{examples}
Q: {question}
SQL:"""


def build_prompt(
    question: str, *, today: date, data_since: datetime, data_through: datetime
) -> str:
    examples = "".join(f"Q: {q}\nSQL:\n{sql}\n\n" for q, sql in EXAMPLES)
    return TEMPLATE.format(
        data_since=data_since.strftime("%Y-%m-%d"),
        data_through=data_through.strftime("%Y-%m-%d %H:%M"),
        today=today.isoformat(),
        examples=examples,
        question=question.strip(),
    )


def build_repair_prompt(prompt: str, sql: str, error: str) -> str:
    """The original prompt plus the failed query and the database's error, asking for a fix."""
    return (
        f"{prompt}\n{sql}\n\n"
        f"That query failed. PostgreSQL said: {error}\n"
        "Fix the query. Reply with the corrected SQL only.\nSQL:"
    )


SUMMARY_TEMPLATE = """\
A visitor asked: {question}

A database query returned these columns: {columns}
and these rows (first {shown} of {total}):
{rows}

Write one or two short plain sentences that answer the question from these rows: the overall \
picture, the highest and lowest where that matters, and anything that stands out. Do not list \
every row; the reader can see them in a chart. Prices are in $/MWh, demand in MW, times are \
Alberta local time. Do not mention SQL or the query."""


def build_summary_prompt(
    question: str, columns: list[str], rows: list[tuple], limit: int = 120
) -> str:
    shown = rows[:limit]
    lines = "\n".join(", ".join(str(v) for v in row) for row in shown)
    return SUMMARY_TEMPLATE.format(
        question=question.strip(),
        columns=", ".join(columns),
        shown=len(shown),
        total=len(rows),
        rows=lines,
    )
