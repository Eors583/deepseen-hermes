from __future__ import annotations

import os
from pathlib import Path
from typing import Any


POSTGRES_ENV_KEYS = (
    "HERMES_DATABASE_URL",
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRESQL_URL",
)


def database_url() -> str:
    for key in POSTGRES_ENV_KEYS:
        value = os.environ.get(key, "").strip()
        if value:
            return value
    for key in POSTGRES_ENV_KEYS:
        value = _project_env_value(key)
        if value:
            return value
    return ""


def _project_env_value(key: str) -> str:
    for env_path in _candidate_env_files():
        value = _read_env_file_value(env_path, key)
        if value:
            return value
    return ""


def _candidate_env_files() -> list[Path]:
    paths: list[Path] = []
    try:
        from hermes_constants import get_hermes_home

        paths.append(get_hermes_home() / ".env")
    except Exception:
        pass
    try:
        cwd = Path.cwd()
        paths.extend([cwd / ".hermes" / ".env", cwd / ".env.prod", cwd / ".env"])
    except Exception:
        pass

    seen: set[Path] = set()
    unique: list[Path] = []
    for path in paths:
        try:
            resolved = path.resolve()
        except Exception:
            resolved = path
        if resolved in seen:
            continue
        seen.add(resolved)
        unique.append(path)
    return unique


def _read_env_file_value(path: Path, key: str) -> str:
    try:
        if not path.is_file():
            return ""
        prefix = f"{key}="
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or not stripped.startswith(prefix):
                continue
            value = stripped[len(prefix):].strip()
            if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]
            return value.strip()
    except Exception:
        return ""
    return ""


def postgres_enabled() -> bool:
    return bool(database_url())


def require_postgres_url() -> str:
    value = database_url()
    if not value:
        keys = ", ".join(POSTGRES_ENV_KEYS)
        raise RuntimeError(
            "PostgreSQL is required for the Deepseen FastAPI backend. "
            f"Set one of: {keys}"
        )
    return value


def _translate_placeholders(sql: str) -> str:
    return sql.replace("?", "%s")


class PgCompatRow(dict):
    """Row object compatible with both sqlite3.Row and psycopg dict rows."""

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class PgCompatCursor:
    def __init__(self, cursor: Any):
        self._cursor = cursor

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    def _wrap(self, row: Any) -> Any:
        if isinstance(row, dict) and not isinstance(row, PgCompatRow):
            return PgCompatRow(row)
        return row

    def fetchone(self) -> Any:
        return self._wrap(self._cursor.fetchone())

    def fetchall(self) -> list[Any]:
        return [self._wrap(row) for row in self._cursor.fetchall()]

    def __iter__(self):
        for row in self._cursor:
            yield self._wrap(row)


class PgCompatConnection:
    """Tiny DB-API compatibility wrapper for existing sqlite-style call sites."""

    is_postgres = True

    def __init__(self, conn: Any):
        self._conn = conn

    def execute(self, sql: str, params: Any = None):
        if params is None:
            return PgCompatCursor(self._conn.execute(_translate_placeholders(sql)))
        return PgCompatCursor(self._conn.execute(_translate_placeholders(sql), params))

    def executescript(self, script: str) -> None:
        for statement in script.split(";"):
            sql = statement.strip()
            if sql:
                self.execute(sql)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if exc_type is None:
                self.commit()
            else:
                self.rollback()
        finally:
            self.close()


def connect() -> PgCompatConnection:
    url = require_postgres_url()
    try:
        import psycopg
        from psycopg.rows import dict_row
    except Exception as exc:
        raise RuntimeError(
            "PostgreSQL storage requires psycopg. Install project dependencies again after pulling this change."
        ) from exc
    conn = psycopg.connect(url, row_factory=dict_row)
    return PgCompatConnection(conn)
