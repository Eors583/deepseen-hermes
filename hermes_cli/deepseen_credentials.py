from __future__ import annotations

import hashlib
import os
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from hermes_cli.config import get_env_value, redact_key
from hermes_cli import postgres_store

PROVIDER = "deepseen"
KEY_NAME = "api_key"
LOCAL_USER_KEY = "local"
MANAGED_CLIENT_NAME = "Deepseen 自动托管"


def _connect() -> Any:
    conn = postgres_store.connect()
    _init_db_postgres(conn)
    return conn


def _init_db_postgres(conn: Any) -> None:
    if _use_deepseen_user_table():
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS herbound_user_credentials (
                user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
                provider TEXT NOT NULL,
                key_name TEXT NOT NULL,
                secret_value TEXT NOT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                PRIMARY KEY (user_id, provider, key_name)
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_herbound_user_credentials_provider
            ON herbound_user_credentials (provider, key_name)
            """
        )

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


def _use_deepseen_user_table() -> bool:
    value = (
        os.environ.get("HERBOUND_AUTH_PROVIDER", "")
        or get_env_value("HERBOUND_AUTH_PROVIDER")
        or _project_env_value("HERBOUND_AUTH_PROVIDER")
        or ""
    )
    return str(value).strip().lower() == "deepseen"


def _project_env_value(key: str) -> str:
    for env_path in (
        Path.cwd() / ".hermes" / ".env",
        Path.cwd() / ".env.prod",
        Path.cwd() / ".env",
    ):
        try:
            if not env_path.is_file():
                continue
            prefix = f"{key}="
            for line in env_path.read_text(encoding="utf-8-sig").splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or not stripped.startswith(prefix):
                    continue
                value = stripped[len(prefix):].strip()
                if (value.startswith('"') and value.endswith('"')) or (
                    value.startswith("'") and value.endswith("'")
                ):
                    value = value[1:-1]
                return value.strip()
        except Exception:
            continue
    return ""


def normalize_user_key(user_key: str | None = None) -> str:
    value = str(user_key or "").strip()
    if value.startswith("user:"):
        value = value[5:].strip()
    return value or LOCAL_USER_KEY


def request_user_key(request: Any) -> str:
    user = getattr(getattr(request, "state", None), "user", None)
    if isinstance(user, dict) and user.get("id") is not None:
        return str(user["id"])
    return LOCAL_USER_KEY


def _read_key(conn: Any, user_key: str) -> str:
    key = normalize_user_key(user_key)
    if _use_deepseen_user_table() and key != LOCAL_USER_KEY:
        row = conn.execute(
            """
            SELECT secret_value
            FROM herbound_user_credentials
            WHERE user_id = ? AND provider = ? AND key_name = ?
            """,
            (key, PROVIDER, KEY_NAME),
        ).fetchone()
        if row:
            return str(row["secret_value"] or "").strip()
        return ""

    legacy_keys = [key]
    if key != LOCAL_USER_KEY:
        legacy_keys.append(f"user:{key}")
    for legacy_key in legacy_keys:
        row = conn.execute(
            """
            SELECT secret_value
            FROM user_credentials
            WHERE user_key = ? AND provider = ? AND key_name = ?
            """,
            (legacy_key, PROVIDER, KEY_NAME),
        ).fetchone()
        if row:
            return str(row["secret_value"] or "").strip()
    return ""


def _user_exists(conn: Any, user_key: str) -> bool:
    key = normalize_user_key(user_key)
    if key in {"", LOCAL_USER_KEY, "default"}:
        return False
    row = conn.execute(
        """
        SELECT id FROM "User" WHERE id = ?
        """,
        (key,),
    ).fetchone()
    return bool(row)


def _raw_api_key() -> str:
    return f"sk_{secrets.token_hex(24)}"


def _hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _new_row_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(16)}"


def _write_managed_key(conn: Any, user_key: str, api_key: str) -> None:
    key = normalize_user_key(user_key)
    now = _now_ms()
    if _use_deepseen_user_table() and key != LOCAL_USER_KEY:
        conn.execute(
            """
            INSERT INTO herbound_user_credentials (user_id, provider, key_name, secret_value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, provider, key_name)
            DO UPDATE SET secret_value = excluded.secret_value, updated_at = excluded.updated_at
            """,
            (key, PROVIDER, KEY_NAME, api_key, now, now),
        )
        return

    conn.execute(
        """
        INSERT INTO user_credentials (user_key, provider, key_name, secret_value, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_key, provider, key_name)
        DO UPDATE SET secret_value = excluded.secret_value, updated_at = excluded.updated_at
        """,
        (key, PROVIDER, KEY_NAME, api_key, now, now),
    )


def _create_deepseen_openapi_key(conn: Any, user_key: str) -> str:
    key = normalize_user_key(user_key)
    if not _use_deepseen_user_table() or not _user_exists(conn, key):
        return ""

    count_row = conn.execute(
        'SELECT COUNT(*) AS count FROM "ApiKey" WHERE "userId" = ?',
        (key,),
    ).fetchone()
    try:
        existing_count = int(count_row["count"] if count_row else 0)
    except Exception:
        existing_count = 0
    if existing_count >= 10:
        raise RuntimeError("DeepSeen API Key 数量已达到上限，请先在 DeepSeen 后台删除不再使用的 Key。")

    raw_key = _raw_api_key()
    now = datetime.now(timezone.utc)
    conn.execute(
        """
        INSERT INTO "ApiKey" (
            id, "userId", "clientName", "keyPrefix", "keyHash", "webhookSecret",
            "quotaMonthly", "usedThisMonth", enabled, "createdAt", "updatedAt"
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            _new_row_id("hbak"),
            key,
            MANAGED_CLIENT_NAME,
            raw_key[:12],
            _hash_api_key(raw_key),
            f"whsec_{secrets.token_hex(16)}",
            10000,
            0,
            True,
            now,
            now,
        ),
    )
    _write_managed_key(conn, key, raw_key)
    return raw_key


def _api_key_record_exists(conn: Any, user_key: str, api_key: str) -> bool:
    key = normalize_user_key(user_key)
    value = str(api_key or "").strip()
    if not _use_deepseen_user_table() or key in {"", LOCAL_USER_KEY, "default"} or not value:
        return True
    row = conn.execute(
        """
        SELECT id
        FROM "ApiKey"
        WHERE "userId" = ? AND "keyHash" = ? AND enabled = TRUE
        """,
        (key, _hash_api_key(value)),
    ).fetchone()
    return bool(row)


def get_deepseen_api_key(user_key: str | None = None) -> str:
    primary = normalize_user_key(user_key)
    with _connect() as conn:
        value = _read_key(conn, primary)
        if value:
            return value
        if primary != LOCAL_USER_KEY and not _use_deepseen_user_table():
            return _read_key(conn, LOCAL_USER_KEY)
    return ""


def ensure_deepseen_api_key(user_key: str | None = None) -> str:
    primary = normalize_user_key(user_key)
    with _connect() as conn:
        value = _read_key(conn, primary)
        if value and _api_key_record_exists(conn, primary, value):
            return value
        if primary not in {"", LOCAL_USER_KEY, "default"}:
            value = _create_deepseen_openapi_key(conn, primary)
            if value:
                conn.commit()
                return value
        if primary != LOCAL_USER_KEY and not _use_deepseen_user_table():
            return _read_key(conn, LOCAL_USER_KEY)
    return ""


def set_deepseen_api_key(api_key: str, user_key: str | None = None) -> dict[str, Any]:
    value = str(api_key or "").strip()
    if not value:
        raise ValueError("DEEPSEEN_API_KEY is required")
    key = normalize_user_key(user_key)
    now = _now_ms()
    with _connect() as conn:
        if _use_deepseen_user_table() and key != LOCAL_USER_KEY:
            conn.execute(
                """
                INSERT INTO herbound_user_credentials (user_id, provider, key_name, secret_value, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, provider, key_name)
                DO UPDATE SET secret_value = excluded.secret_value, updated_at = excluded.updated_at
                """,
                (key, PROVIDER, KEY_NAME, value, now, now),
            )
        else:
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
        if _use_deepseen_user_table() and key != LOCAL_USER_KEY:
            conn.execute(
                """
                DELETE FROM herbound_user_credentials
                WHERE user_id = ? AND provider = ? AND key_name = ?
                """,
                (key, PROVIDER, KEY_NAME),
            )
        conn.execute(
            """
            DELETE FROM user_credentials
            WHERE user_key IN (?, ?) AND provider = ? AND key_name = ?
            """,
            (key, f"user:{key}", PROVIDER, KEY_NAME),
        )
        conn.commit()
    return deepseen_key_status(key)


def deepseen_key_status(user_key: str | None = None) -> dict[str, Any]:
    key = normalize_user_key(user_key)
    value = ensure_deepseen_api_key(key)
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
