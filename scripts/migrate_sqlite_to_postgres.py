from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path
from typing import Iterable

from hermes_constants import get_hermes_home
from hermes_cli import postgres_store
from hermes_cli.enterprise_skills import db as enterprise_db
from hermes_cli.postgres_session_db import PostgresSessionDB
from hermes_cli.web_auth import _init_db_postgres as init_web_auth_postgres
from gateway.platforms.api_server import ResponseStore


WEB_AUTH_TABLES = (
    "users",
    "user_profiles",
    "user_credentials",
)

ENTERPRISE_TABLES = (
    "organizations",
    "teams",
    "user_organization_memberships",
    "user_team_memberships",
    "employee_profiles",
    "employee_skill_assignments",
    "skill_definitions",
    "skill_versions",
    "skill_files",
    "skill_visibility_rules",
    "skill_runtime_snapshots",
    "skill_usage_events",
    "skill_feedback",
    "skill_proposals",
    "skill_audit_logs",
)

STATE_TABLES = (
    "schema_version",
    "sessions",
    "messages",
    "state_meta",
    "compression_locks",
)

RESPONSE_STORE_TABLES = (
    "responses",
    "conversations",
)

SEQUENCE_COLUMNS = (
    ("users", "id"),
    ("messages", "id"),
)

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _ident(value: str) -> str:
    if not _IDENT_RE.match(value):
        raise ValueError(f"Unsafe SQL identifier: {value!r}")
    return value


def _pg_columns(pg_conn, table: str) -> list[str]:
    rows = pg_conn.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?
        ORDER BY ordinal_position
        """,
        (table,),
    ).fetchall()
    return [str(row["column_name"]) for row in rows]


def _sqlite_count(path: Path, table: str) -> int:
    if not path.exists():
        return 0
    conn = sqlite3.connect(path)
    try:
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
            (table,),
        ).fetchone()
        if not exists:
            return 0
        return int(conn.execute(f"SELECT COUNT(*) FROM {_ident(table)}").fetchone()[0])
    finally:
        conn.close()


def _pg_count(pg_conn, table: str) -> int:
    row = pg_conn.execute(f"SELECT COUNT(*) FROM {_ident(table)}").fetchone()
    return int(row[0] if row else 0)


def _sqlite_rows(path: Path, table: str) -> tuple[list[str], list[sqlite3.Row]]:
    if not path.exists():
        return [], []
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
            (table,),
        ).fetchone()
        if not exists:
            return [], []
        safe_table = _ident(table)
        columns = [str(row["name"]) for row in conn.execute(f"PRAGMA table_info({safe_table})").fetchall()]
        rows = conn.execute(f"SELECT * FROM {safe_table}").fetchall()
        return columns, rows
    finally:
        conn.close()


def _copy_table(pg_conn, sqlite_path: Path, table: str) -> int:
    columns, rows = _sqlite_rows(sqlite_path, table)
    if not columns or not rows:
        return 0
    if table == "user_profiles" and "user_id" in columns:
        valid_user_ids = {
            int(row["id"])
            for row in pg_conn.execute("SELECT id FROM users").fetchall()
            if row.get("id") is not None
        }
        before = len(rows)
        rows = [row for row in rows if int(row["user_id"]) in valid_user_ids]
        skipped = before - len(rows)
        if skipped:
            print(
                f"warning: skipped {skipped} orphan row(s): {sqlite_path.name}:{table}",
                file=sys.stderr,
            )
    target_columns = set(_pg_columns(pg_conn, table))
    columns = [column for column in columns if column in target_columns]
    if not columns:
        return 0
    col_sql = ", ".join(_ident(column) for column in columns)
    placeholders = ", ".join(["?"] * len(columns))
    sql = f"INSERT INTO {_ident(table)} ({col_sql}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
    count = 0
    for row in rows:
        cur = pg_conn.execute(sql, tuple(row[col] for col in columns))
        if cur.rowcount and cur.rowcount > 0:
            count += int(cur.rowcount)
    return count


def _copy_tables(pg_conn, sqlite_path: Path, tables: Iterable[str]) -> int:
    total = 0
    for table in tables:
        sqlite_before = _sqlite_count(sqlite_path, table)
        count = _copy_table(pg_conn, sqlite_path, table)
        pg_after = _pg_count(pg_conn, table)
        print(
            f"{sqlite_path.name}:{table} sqlite={sqlite_before} inserted={count} postgresql={pg_after}"
        )
        total += count
    return total


def _prepare_enterprise_for_import(pg_conn, sqlite_path: Path) -> None:
    if not sqlite_path.exists():
        return
    for table in reversed(ENTERPRISE_TABLES):
        pg_conn.execute(f"DELETE FROM {_ident(table)}")


def _prepare_state_for_import(pg_conn, sqlite_path: Path) -> None:
    if not sqlite_path.exists():
        return
    for table in reversed(STATE_TABLES):
        pg_conn.execute(f"DELETE FROM {_ident(table)}")


def _reset_sequences(pg_conn) -> None:
    for table, column in SEQUENCE_COLUMNS:
        try:
            pg_conn.execute(
                f"""
                SELECT setval(
                    pg_get_serial_sequence('{_ident(table)}', '{_ident(column)}'),
                    GREATEST(COALESCE((SELECT MAX({_ident(column)}) FROM {_ident(table)}), 0), 1),
                    true
                )
                """
            )
        except Exception as exc:
            print(f"warning: failed to reset sequence for {table}.{column}: {exc}", file=sys.stderr)


def main() -> int:
    if not postgres_store.postgres_enabled():
        print("DATABASE_URL/HERMES_DATABASE_URL is required for PostgreSQL migration.", file=sys.stderr)
        return 2

    hermes_home = get_hermes_home()
    web_auth_db = hermes_home / "web-auth" / "auth.db"
    enterprise_sqlite_db = hermes_home / "enterprise-skills" / "enterprise_skills.db"
    state_sqlite_db = hermes_home / "state.db"
    response_sqlite_db = hermes_home / "response_store.db"

    pg_conn = postgres_store.connect()
    try:
        init_web_auth_postgres(pg_conn)
        enterprise_db.init_db(pg_conn)
        pg_state = PostgresSessionDB()
        pg_state.close()
        response_store = ResponseStore()
        response_store.close()
        total = 0
        total += _copy_tables(pg_conn, web_auth_db, WEB_AUTH_TABLES)
        _prepare_enterprise_for_import(pg_conn, enterprise_sqlite_db)
        total += _copy_tables(pg_conn, enterprise_sqlite_db, ENTERPRISE_TABLES)
        _prepare_state_for_import(pg_conn, state_sqlite_db)
        total += _copy_tables(pg_conn, state_sqlite_db, STATE_TABLES)
        total += _copy_tables(pg_conn, response_sqlite_db, RESPONSE_STORE_TABLES)
        _reset_sequences(pg_conn)
        pg_conn.commit()
    except Exception:
        pg_conn.rollback()
        raise
    finally:
        pg_conn.close()

    print(f"migration complete, copied {total} row(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
