"""The SQL guard: decides whether model-written SQL may run, and adds a row limit.

Defence in depth:

1. the query runs as the read-only role ``app_readonly`` (db/002_readonly_user.sql), which
   can only SELECT from the two market tables and has a statement timeout. That holds even
   if this module has a bug;
2. this module parses the SQL with sqlglot and accepts exactly one SELECT, with no writing
   statement anywhere inside it (CTEs included);
3. tables must be on the allowlist, so no system catalogs;
4. dangerous or server-revealing functions are blocked;
5. a row limit is enforced (api.readonly adds a size limit on top).

Usage: ``safe_sql = guard(model_sql)``, then run ``safe_sql`` through ``api.readonly.run``.
"""

from __future__ import annotations

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

ALLOWED_TABLES = frozenset({"pool_price", "system_load"})
ROW_LIMIT = 1000

# Anything that writes, locks, or leaves SELECT-land. Refused wherever it appears in the tree.
FORBIDDEN_NODES = (
    exp.DML,
    exp.DDL,
    exp.Command,
    exp.Copy,
    exp.Grant,
    exp.Set,
    exp.Transaction,
    exp.Commit,
    exp.Rollback,
    exp.Lock,
    exp.Into,
)
BLOCKED_FUNCTION_PREFIXES = ("pg_", "lo_", "dblink", "inet_")
BLOCKED_FUNCTIONS = frozenset(
    {
        "set_config",
        "current_setting",
        "query_to_xml",
        "database_to_xml",
        "table_to_xml",
        "version",
        "current_version",  # how sqlglot names version()
        "current_user",
        "session_user",
        "user",
        "current_role",
        "current_database",
        "current_catalog",
        "current_schema",
    }
)


class GuardError(ValueError):
    """The SQL was refused. The message is short and safe to show to a visitor."""


def guard(sql: str) -> str:
    """Return the SQL to run, or raise GuardError."""
    try:
        statements = [s for s in sqlglot.parse(sql, read="postgres") if s is not None]
    except ParseError as exc:
        what, _, _ = str(exc).partition("\n")  # the rest quotes the SQL with terminal codes
        raise GuardError(f"could not parse the SQL: {what}") from None
    if len(statements) != 1:
        raise GuardError("exactly one statement is allowed")
    stmt = statements[0]
    if not isinstance(stmt, exp.Select | exp.SetOperation):
        raise GuardError("only SELECT queries are allowed")

    for node in stmt.walk():
        if isinstance(node, FORBIDDEN_NODES):
            raise GuardError(f"{node.key.upper()} is not allowed")

    cte_names = {cte.alias_or_name.lower() for cte in stmt.find_all(exp.CTE)}
    for table in stmt.find_all(exp.Table):
        name = table.name.lower()
        if table.catalog or (table.db and table.db.lower() != "public"):
            raise GuardError(f"table {table.sql()} is not allowed")
        if name in cte_names and not table.db:
            continue
        if name not in ALLOWED_TABLES:
            raise GuardError(f"table {table.sql() or '(unnamed)'} is not allowed")

    # Functions, and bare names such as current_user that PostgreSQL treats as functions.
    for node in stmt.find_all(exp.Func, exp.Column):
        name = node.name if isinstance(node, exp.Anonymous | exp.Column) else node.sql_name()
        name = name.lower()
        if name.startswith(BLOCKED_FUNCTION_PREFIXES) or name in BLOCKED_FUNCTIONS:
            raise GuardError(f"{name} is not allowed")

    limit = _limit_of(stmt)
    if limit is None or limit > ROW_LIMIT:
        stmt = stmt.limit(ROW_LIMIT)
    return stmt.sql(dialect="postgres", pretty=True)  # the page shows this; keep it readable


def _limit_of(stmt: exp.Expression) -> int | None:
    """The query's own LIMIT as an int, or None when absent or not a plain number."""
    limit = stmt.args.get("limit")
    if limit is None:
        return None
    value = limit.expression
    if isinstance(value, exp.Literal) and value.is_int:
        return int(value.this)
    return None
