from __future__ import annotations

import time
from typing import Any

from hermes_cli.config import redact_key
from hermes_cli import postgres_store

PROVIDER = "deepseen"
KEY_NAME = "api_key"
LOCAL_USER_KEY = "local"


def _connect() -> Any:
    conn = postgres_store.connect()
    _init_db_postgres(conn)
    return conn


def _init_db_postgres(conn: Any) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_credentials (
            user_key TEXT NOT NULL,
            provider TEXT NOT NULL,
            key_name TEXT NOT NULL,
            secret_value TEXT NOT NULL,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            PRIMARY KEY (user_key, provider, key_name)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_credentials_provider
        ON user_credentials (provider, key_name)
        """
    )
    conn.commit()


def _now_ms() -> int:
    return int(time.time() * 1000)


def normalize_user_key(user_key: str | None = None) -> str:
    value = str(user_key or "").strip()
    return value or LOCAL_USER_KEY


def request_user_key(request: Any) -> str:
    user = getattr(getattr(request, "state", None), "user", None)
    if isinstance(user, dict) and user.get("id") is not None:
        return f"user:{user['id']}"
    return LOCAL_USER_KEY


def _read_key(conn: Any, user_key: str) -> str:
    row = conn.execute(
        """
        SELECT secret_value
        FROM user_credentials
        WHERE user_key = ? AND provider = ? AND key_name = ?
        """,
        (normalize_user_key(user_key), PROVIDER, KEY_NAME),
    ).fetchone()
    return str(row["secret_value"] or "").strip() if row else ""


def get_deepseen_api_key(user_key: str | None = None) -> str:
    primary = normalize_user_key(user_key)
    with _connect() as conn:
        value = _read_key(conn, primary)
        if value:
            return value
        if primary != LOCAL_USER_KEY:
            return _read_key(conn, LOCAL_USER_KEY)
    return ""


def set_deepseen_api_key(api_key: str, user_key: str | None = None) -> dict[str, Any]:
    value = str(api_key or "").strip()
    if not value:
        raise ValueError("DEEPSEEN_API_KEY is required")
    key = normalize_user_key(user_key)
    now = _now_ms()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO user_credentials (user_key, provider, key_name, secret_value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_key, provider, key_name)
            DO UPDATE SET secret_value = excluded.secret_value, updated_at = excluded.updated_at
            """,
            (key, PROVIDER, KEY_NAME, value, now, now),
        )
        conn.commit()
    return deepseen_key_status(key)


def delete_deepseen_api_key(user_key: str | None = None) -> dict[str, Any]:
    key = normalize_user_key(user_key)
    with _connect() as conn:
        conn.execute(
            """
            DELETE FROM user_credentials
            WHERE user_key = ? AND provider = ? AND key_name = ?
            """,
            (key, PROVIDER, KEY_NAME),
        )
        conn.commit()
    return deepseen_key_status(key)


def deepseen_key_status(user_key: str | None = None) -> dict[str, Any]:
    key = normalize_user_key(user_key)
    value = get_deepseen_api_key(key)
    return {
        "configured": bool(value),
        "redacted_value": redact_key(value) if value else "",
        "storage": "database",
        "db_path": "postgresql",
        "user_key": key,
        "provider": PROVIDER,
        "key_name": KEY_NAME,
        "env_var": "DEEPSEEN_API_KEY",
    }
