"""FastAPI-native auth for the Herbound web UI.

This module ports the hermes-web-ui Koa auth surface into Hermes' native
FastAPI server so production deployments can run a single backend.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from hermes_constants import get_hermes_home
from hermes_cli import postgres_store

UserRole = Literal["super_admin", "admin", "vip", "user"]
UserStatus = Literal["active", "disabled"]

DEFAULT_USERNAME = "admin"
DEFAULT_PASSWORD = "123456"
JWT_TTL_SECONDS = 7 * 24 * 60 * 60
MAX_AVATAR_BYTES = 500 * 1024

IP_MAX_FAILURES = 10
IP_FAILURE_WINDOW_MS = 15 * 60_000
IP_LOCK_DURATION_MS = 60 * 60_000
GLOBAL_WINDOW_MS = 60_000
GLOBAL_MAX_REQUESTS_PER_WINDOW = 100
GLOBAL_MAX_TOTAL_FAILURES = 50
GLOBAL_LOCK_DURATION_MS = 30 * 60_000

router = APIRouter()
_log = logging.getLogger(__name__)


def _auth_dir() -> Path:
    path = get_hermes_home() / "web-auth"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _secret_path() -> Path:
    return _auth_dir() / "jwt.secret"


def _lock_path() -> Path:
    return _auth_dir() / "login-lock.json"


def _connect() -> Any:
    conn = postgres_store.connect()
    if not _deepseen_auth_enabled():
        _init_db_postgres(conn)
    return conn


def _deepseen_auth_enabled() -> bool:
    provider = os.environ.get("HERBOUND_AUTH_PROVIDER", "").strip().lower()
    if not provider:
        try:
            provider = postgres_store._project_env_value("HERBOUND_AUTH_PROVIDER").strip().lower()
        except Exception:
            provider = ""
    if provider:
        return provider in {"deepseen", "deepseen-users", "shared-deepseen"}
    shared_auth = os.environ.get("DEEPSEEN_SHARED_AUTH", "").strip().lower()
    if not shared_auth:
        try:
            shared_auth = postgres_store._project_env_value("DEEPSEEN_SHARED_AUTH").strip().lower()
        except Exception:
            shared_auth = ""
    return shared_auth in {"1", "true", "yes", "on"}


def _init_db_postgres(conn: Any) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('super_admin', 'admin')),
            status TEXT NOT NULL CHECK(status IN ('active', 'disabled')),
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            last_login_at BIGINT,
            avatar TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id BIGINT NOT NULL,
            profile_name TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL,
            PRIMARY KEY (user_id, profile_name),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
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


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=bytes.fromhex(salt),
        n=16384,
        r=8,
        p=1,
        dklen=64,
    ).hex()
    return f"scrypt:{salt}:{digest}"


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        scheme, salt, expected_hex = password_hash.split(":", 2)
        if scheme != "scrypt":
            return False
        expected = bytes.fromhex(expected_hex)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt),
            n=16384,
            r=8,
            p=1,
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def _jwt_secret() -> bytes:
    if _deepseen_auth_enabled():
        raw = os.environ.get("JWT_SECRET", "").strip()
        value = raw or "viralforge-dev-secret-change-in-production"
        return value.encode("utf-8")

    path = _secret_path()
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if value:
            return value.encode("utf-8")
    value = secrets.token_urlsafe(48)
    path.write_text(value + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return value.encode("utf-8")


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _issue_jwt(user: Any) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    if _deepseen_auth_enabled():
        payload = {
            "userId": str(user["id"]),
            "email": str(user.get("email") or user.get("username") or ""),
            "type": "access",
            "iss": "viralforge",
            "sub": str(user["id"]),
            "username": user["username"],
            "role": user["role"],
            "iat": now,
            "exp": now + JWT_TTL_SECONDS,
        }
    else:
        payload = {
            "sub": str(user["id"]),
            "username": user["username"],
            "role": user["role"],
            "iat": now,
            "exp": now + JWT_TTL_SECONDS,
        }
    signing_input = ".".join([
        _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
    ])
    signature = hmac.new(_jwt_secret(), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


def _issue_deepseen_refresh_token(user: Any) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "userId": str(user["id"]),
        "email": str(user.get("email") or user.get("username") or ""),
        "type": "refresh",
        "iss": "viralforge",
        "iat": now,
        "exp": now + JWT_TTL_SECONDS,
    }
    signing_input = ".".join([
        _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
    ])
    signature = hmac.new(_jwt_secret(), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


def _deepseen_role(value: Any) -> UserRole:
    role = str(value or "").upper()
    if role == "SUPER_ADMIN":
        return "super_admin"
    if role == "ADMIN":
        return "admin"
    if role == "VIP":
        return "vip"
    return "user"


def _deepseen_status(value: Any) -> UserStatus:
    return "active" if str(value or "").upper() == "ACTIVE" else "disabled"


def _deepseen_username(row: Any) -> str:
    return str(row.get("email") or row.get("name") or row.get("id") or "")


def _deepseen_avatar(row: Any) -> str:
    image = row.get("image") or ""
    if not image:
        return ""
    if isinstance(image, str) and image.startswith("data:image/"):
        return json.dumps({"type": "image", "dataUrl": image}, ensure_ascii=False, separators=(",", ":"))
    return json.dumps({"type": "default", "seed": _deepseen_username(row)}, ensure_ascii=False, separators=(",", ":"))


def _deepseen_auth_user(row: Any) -> Dict[str, Any]:
    return {
        "id": str(row["id"]),
        "username": _deepseen_username(row),
        "role": _deepseen_role(row.get("role")),
        "status": _deepseen_status(row.get("status")),
        "created_at": _datetime_to_ms(row.get("createdAt")),
        "updated_at": _datetime_to_ms(row.get("updatedAt")),
        "last_login_at": _datetime_to_ms(row.get("lastLoginAt")),
        "avatar": _deepseen_avatar(row),
        "email": row.get("email") or "",
        "display_name": row.get("name") or row.get("email") or "",
    }


def _datetime_to_ms(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    try:
        return int(value.timestamp() * 1000)
    except Exception:
        return None


def _deepseen_row_to_user(row: Any) -> Dict[str, Any]:
    user = _deepseen_auth_user(row)
    out = dict(user)
    out["requiresCredentialChange"] = False
    return out


def _deepseen_verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        import bcrypt

        return bool(bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8")))
    except Exception as exc:
        _log.warning("DeepSeen password verification failed: %s: %s", type(exc).__name__, exc)
        return False


def _deepseen_verify_dummy_password(password: str) -> None:
    """Match DeepSeen's missing-user bcrypt work to avoid an obvious timing gap."""
    dummy_hash = "$2b$12$CwTycUXWue0Thq9StjUM0uJ8N9ZQxWYrJ7IY6zWfJXzfs7ZQ2d6rC"
    try:
        _deepseen_verify_password(password or "dummy", dummy_hash)
    except Exception:
        pass


def _deepseen_find_user(conn: Any, user_id: Any) -> Optional[Any]:
    user_id_str = str(user_id or "").strip()
    if not user_id_str:
        return None
    return conn.execute(
        'SELECT * FROM "User" WHERE id = ?',
        (user_id_str,),
    ).fetchone()


def _deepseen_find_login_user(conn: Any, username: str) -> Optional[Any]:
    candidate = username.strip().lower()
    if not candidate:
        return None
    return conn.execute(
        'SELECT * FROM "User" WHERE lower(email) = lower(?) LIMIT 1',
        (candidate,),
    ).fetchone()


def _deepseen_count_users(conn: Any) -> int:
    return int(_scalar(conn.execute('SELECT COUNT(*) FROM "User"').fetchone()))


def _deepseen_update_last_login(conn: Any, user_id: str, refresh_token: str | None = None) -> None:
    try:
        if refresh_token:
            conn.execute(
                """
                UPDATE "User"
                SET "lastLoginAt" = CURRENT_TIMESTAMP,
                    "updatedAt" = CURRENT_TIMESTAMP,
                    "refreshToken" = ?,
                    "previousRefreshToken" = NULL,
                    "previousRefreshTokenExpiresAt" = NULL
                WHERE id = ?
                """,
                (refresh_token, user_id),
            )
        else:
            conn.execute(
                'UPDATE "User" SET "lastLoginAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ?',
                (user_id,),
            )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def _verify_jwt(token: str) -> Optional[Dict[str, Any]]:
    try:
        header_b64, payload_b64, signature_b64 = token.split(".", 2)
        signing_input = f"{header_b64}.{payload_b64}"
        expected = hmac.new(_jwt_secret(), signing_input.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64url_decode(signature_b64)):
            return None
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
        if int(payload.get("exp") or 0) < int(time.time()):
            return None
        if _deepseen_auth_enabled():
            token_type = str(payload.get("type") or "access")
            if token_type != "access":
                return None
            if str(payload.get("iss") or "viralforge") != "viralforge":
                return None
        else:
            if payload.get("role") not in {"super_admin", "admin"}:
                return None
        return payload
    except Exception:
        return None


def _row_to_user(row: Any) -> Dict[str, Any]:
    return {
        "id": int(row["id"]),
        "username": row["username"],
        "role": row["role"],
        "status": row["status"],
        "created_at": int(row["created_at"]),
        "updated_at": int(row["updated_at"]),
        "last_login_at": row["last_login_at"],
        "avatar": row["avatar"] or "",
    }


def _list_profile_names() -> List[str]:
    try:
        from hermes_cli import profiles as profiles_mod

        names = [str(item.get("name") or "") for item in profiles_mod.list_profiles()]
        names = [name for name in names if name]
        return names or ["default"]
    except Exception:
        return ["default"]


def _list_user_profiles(conn: Any, user_id: int) -> List[Any]:
    return conn.execute(
        "SELECT * FROM user_profiles WHERE user_id = ? ORDER BY is_default DESC, profile_name ASC",
        (user_id,),
    ).fetchall()


def _replace_user_profiles(
    conn: Any,
    user_id: int,
    profiles: List[str],
    default_profile: Optional[str] = None,
) -> None:
    unique = []
    for profile in profiles:
        name = str(profile or "").strip()
        if name and name not in unique:
            unique.append(name)
    default_name = default_profile if default_profile in unique else (unique[0] if unique else None)
    now = _now_ms()
    conn.execute("DELETE FROM user_profiles WHERE user_id = ?", (user_id,))
    for profile in unique:
        conn.execute(
            "INSERT INTO user_profiles (user_id, profile_name, is_default, created_at) VALUES (?, ?, ?, ?)",
            (user_id, profile, 1 if profile == default_name else 0, now),
        )


def _user_summary(conn: Any, row: Any) -> Dict[str, Any]:
    profiles = _list_user_profiles(conn, int(row["id"]))
    return {
        "id": int(row["id"]),
        "username": row["username"],
        "role": row["role"],
        "status": row["status"],
        "profiles": [p["profile_name"] for p in profiles],
        "default_profile": next((p["profile_name"] for p in profiles if int(p["is_default"]) == 1), None),
        "created_at": int(row["created_at"]),
        "updated_at": int(row["updated_at"]),
        "last_login_at": row["last_login_at"],
    }


def _list_users(conn: Any) -> List[Dict[str, Any]]:
    rows = conn.execute(
        "SELECT id, username, role, status, created_at, updated_at, last_login_at FROM users ORDER BY id ASC"
    ).fetchall()
    return [_user_summary(conn, row) for row in rows]


def _scalar(row: Any) -> Any:
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]


def _count_users(conn: Any) -> int:
    return int(_scalar(conn.execute("SELECT COUNT(*) FROM users").fetchone()))


def _count_active_super_admins(conn: Any, exclude_id: Optional[int] = None) -> int:
    if exclude_id:
        row = conn.execute(
            "SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND status = 'active' AND id != ?",
            (exclude_id,),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND status = 'active'"
        ).fetchone()
    return int(_scalar(row))


def _find_user(conn: Any, user_id: Any) -> Optional[Any]:
    try:
        uid = int(user_id)
    except Exception:
        return None
    return conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()


def _find_user_by_username(conn: Any, username: str) -> Optional[Any]:
    return conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()


def _create_user(
    conn: Any,
    username: str,
    password: str,
    role: UserRole = "admin",
    status: UserStatus = "active",
    profiles: Optional[List[str]] = None,
    default_profile: Optional[str] = None,
) -> Any:
    now = _now_ms()
    row = conn.execute(
        """
        INSERT INTO users (username, password_hash, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
        """,
        (username, _hash_password(password), role, status, now, now),
    ).fetchone()
    user_id = int(row["id"])
    _replace_user_profiles(conn, user_id, [] if role == "super_admin" else (profiles or []), default_profile)
    conn.commit()
    row = _find_user(conn, user_id)
    if row is None:
        raise RuntimeError("Failed to create user")
    return row


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


def _load_locks() -> Dict[str, Any]:
    path = _lock_path()
    if not path.exists():
        return {
            "passwordIpMap": {},
            "tokenIpMap": {},
            "pairingIpMap": {},
            "globalMinuteCount": 0,
            "globalMinuteWindow": 0,
            "globalTotalFailures": 0,
            "globalLockedUntil": 0,
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        for key in ("passwordIpMap", "tokenIpMap", "pairingIpMap"):
            data.setdefault(key, {})
        data.setdefault("globalMinuteCount", 0)
        data.setdefault("globalMinuteWindow", 0)
        data.setdefault("globalTotalFailures", 0)
        data.setdefault("globalLockedUntil", 0)
        return data
    except Exception:
        return _load_locks_fresh()


def _load_locks_fresh() -> Dict[str, Any]:
    return {
        "passwordIpMap": {},
        "tokenIpMap": {},
        "pairingIpMap": {},
        "globalMinuteCount": 0,
        "globalMinuteWindow": 0,
        "globalTotalFailures": 0,
        "globalLockedUntil": 0,
    }


def _save_locks(data: Dict[str, Any]) -> None:
    path = _lock_path()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _check_password_limiter(ip: str) -> tuple[bool, int]:
    data = _load_locks()
    now = _now_ms()
    if int(data.get("globalLockedUntil") or 0) > now:
        return False, 503
    if now - int(data.get("globalMinuteWindow") or 0) >= GLOBAL_WINDOW_MS:
        data["globalMinuteWindow"] = now
        data["globalMinuteCount"] = 0
    if int(data.get("globalMinuteCount") or 0) >= GLOBAL_MAX_REQUESTS_PER_WINDOW:
        _save_locks(data)
        return False, 429
    for map_key in ("passwordIpMap", "tokenIpMap", "pairingIpMap"):
        entry = data.get(map_key, {}).get(ip)
        if entry and int(entry.get("lockedUntil") or 0) > now:
            return False, 429
    data["globalMinuteCount"] = int(data.get("globalMinuteCount") or 0) + 1
    _save_locks(data)
    return True, 200


def _record_password_failure(ip: str) -> None:
    data = _load_locks()
    now = _now_ms()
    entry = data["passwordIpMap"].setdefault(ip, {"failures": 0, "lockedUntil": 0, "firstFailureAt": now})
    if now - int(entry.get("firstFailureAt") or now) > IP_FAILURE_WINDOW_MS:
        entry.update({"failures": 0, "lockedUntil": 0, "firstFailureAt": now})
    entry["failures"] = int(entry.get("failures") or 0) + 1
    data["globalTotalFailures"] = int(data.get("globalTotalFailures") or 0) + 1
    if entry["failures"] >= IP_MAX_FAILURES:
        entry["lockedUntil"] = now + IP_LOCK_DURATION_MS
    if int(data["globalTotalFailures"]) >= GLOBAL_MAX_TOTAL_FAILURES:
        data["globalLockedUntil"] = now + GLOBAL_LOCK_DURATION_MS
    _save_locks(data)


def _record_password_success(ip: str) -> None:
    data = _load_locks()
    if ip in data.get("passwordIpMap", {}):
        del data["passwordIpMap"][ip]
        data["globalTotalFailures"] = 0
        _save_locks(data)


def _locked_ips() -> List[Dict[str, Any]]:
    data = _load_locks()
    now = _now_ms()
    rows = []
    for map_key, typ in (("passwordIpMap", "password"), ("tokenIpMap", "token"), ("pairingIpMap", "pairing")):
        for ip, entry in data.get(map_key, {}).items():
            if int(entry.get("lockedUntil") or 0) > now:
                rows.append({
                    "ip": ip,
                    "type": typ,
                    "failures": int(entry.get("failures") or 0),
                    "lockedUntil": int(entry.get("lockedUntil") or 0),
                })
    return rows


def _unlock_ip(ip: Optional[str] = None) -> int:
    data = _load_locks()
    count = len(_locked_ips())
    if ip:
        removed = 0
        for map_key in ("passwordIpMap", "tokenIpMap", "pairingIpMap"):
            if ip in data.get(map_key, {}):
                del data[map_key][ip]
                removed += 1
        _save_locks(data)
        return removed
    data["passwordIpMap"] = {}
    data["tokenIpMap"] = {}
    data["pairingIpMap"] = {}
    data["globalTotalFailures"] = 0
    data["globalLockedUntil"] = 0
    _save_locks(data)
    return count


def authenticate_bearer_token(token: str) -> Optional[Dict[str, Any]]:
    payload = _verify_jwt(token)
    if not payload:
        return None
    with _connect() as conn:
        if _deepseen_auth_enabled():
            user = _deepseen_find_user(conn, payload.get("sub") or payload.get("userId"))
            if not user or _deepseen_status(user.get("status")) != "active":
                return None
            if user.get("refreshToken") is None:
                return None
            mapped = _deepseen_auth_user(user)
            return {
                "id": mapped["id"],
                "username": mapped["username"],
                "role": mapped["role"],
                "email": mapped["email"],
                "display_name": mapped["display_name"],
            }
        user = _find_user(conn, payload.get("sub"))
        if not user or user["status"] != "active":
            return None
        return {
            "id": int(user["id"]),
            "username": user["username"],
            "role": user["role"],
        }


def current_request_user(request: Request) -> Dict[str, Any]:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def require_super_admin(request: Request) -> Dict[str, Any]:
    user = current_request_user(request)
    if user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    return user


def validate_avatar(value: Any) -> str:
    if isinstance(value, str):
        if len(value) > MAX_AVATAR_BYTES * 2:
            raise HTTPException(status_code=400, detail="Avatar string is too large")
        try:
            parsed = json.loads(value)
        except Exception:
            raise HTTPException(status_code=400, detail="Avatar string is not valid JSON")
    else:
        parsed = value
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Invalid avatar payload")
    typ = parsed.get("type")
    if typ not in {"image", "default"}:
        raise HTTPException(status_code=400, detail='Avatar type must be "image" or "default"')
    if typ == "image":
        data_url = parsed.get("dataUrl")
        if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
            raise HTTPException(status_code=400, detail="Image avatar must include a dataUrl")
        if len(data_url) > MAX_AVATAR_BYTES:
            raise HTTPException(status_code=400, detail=f"Avatar image is too large (max {MAX_AVATAR_BYTES} bytes)")
    if parsed.get("seed") is not None and not isinstance(parsed.get("seed"), str):
        raise HTTPException(status_code=400, detail="Avatar seed must be a string")
    return json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))


class LoginBody(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    password: str


class RegisterBody(BaseModel):
    username: str
    password: str


class PasswordBody(BaseModel):
    currentPassword: str
    newPassword: str


class UsernameBody(BaseModel):
    currentPassword: str
    newUsername: str


class AvatarBody(BaseModel):
    avatar: Optional[Any] = None


class ManagedUserBody(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    profiles: Optional[List[str]] = None
    defaultProfile: Optional[str] = None


@router.get("/api/auth/status")
async def auth_status():
    with _connect() as conn:
        if _deepseen_auth_enabled():
            return {"hasPasswordLogin": True, "hasUsers": _deepseen_count_users(conn) > 0}
        return {"hasPasswordLogin": True, "hasUsers": _count_users(conn) > 0}


@router.post("/api/auth/login")
async def login(request: Request, body: LoginBody):
    username = (body.email or body.username or "").strip()
    password = body.password
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")
    ip = _client_ip(request)
    allowed, status = _check_password_limiter(ip)
    if not allowed:
        raise HTTPException(status_code=status, detail="Too many login attempts, please try again later")

    with _connect() as conn:
        if _deepseen_auth_enabled():
            user = _deepseen_find_login_user(conn, username)
            if not user or not user.get("password"):
                _deepseen_verify_dummy_password(password)
                _record_password_failure(ip)
                raise HTTPException(status_code=401, detail="Invalid username or password")
            if not _deepseen_verify_password(password, user.get("password")):
                _record_password_failure(ip)
                raise HTTPException(status_code=401, detail="Invalid username or password")
            if str(user.get("status") or "").upper() in {"BANNED", "SUSPENDED"}:
                _record_password_failure(ip)
                raise HTTPException(status_code=403, detail="Account is not active")
            mapped = _deepseen_auth_user(user)
            token = _issue_jwt(mapped)
            refresh_token = _issue_deepseen_refresh_token(mapped)
            _deepseen_update_last_login(conn, mapped["id"], refresh_token)
            _record_password_success(ip)
            return {"token": token, "refreshToken": refresh_token}
        user_count = _count_users(conn)
        user = None
        if user_count == 0:
            if username == DEFAULT_USERNAME and password == DEFAULT_PASSWORD:
                user = _create_user(conn, DEFAULT_USERNAME, DEFAULT_PASSWORD, "super_admin", "active", [])
        else:
            user = _find_user_by_username(conn, username)
        if not user or user["status"] != "active" or (user_count > 0 and not _verify_password(password, user["password_hash"])):
            _record_password_failure(ip)
            raise HTTPException(status_code=401, detail="Invalid username or password")
        token = _issue_jwt(user)
        conn.execute("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", (_now_ms(), _now_ms(), user["id"]))
        conn.commit()
    _record_password_success(ip)
    return {"token": token}


@router.post("/api/auth/register")
async def register(request: Request, body: RegisterBody):
    if _deepseen_auth_enabled():
        raise HTTPException(
            status_code=403,
            detail="Registration is managed by DeepSeen. Please create the account in DeepSeen first.",
        )
    username = body.username.strip()
    password = body.password
    if len(username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    ip = _client_ip(request)
    allowed, status = _check_password_limiter(ip)
    if not allowed:
        raise HTTPException(status_code=status, detail="Too many registration attempts, please try again later")

    with _connect() as conn:
        if _find_user_by_username(conn, username):
            _record_password_failure(ip)
            raise HTTPException(status_code=409, detail="Username already exists")
        first_user = _count_users(conn) == 0
        role: UserRole = "super_admin" if first_user else "admin"
        user = _create_user(conn, username, password, role, "active", [] if first_user else _list_profile_names())
        token = _issue_jwt(user)
        conn.execute("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", (_now_ms(), _now_ms(), user["id"]))
        conn.commit()
    _record_password_success(ip)
    return JSONResponse(status_code=201, content={"token": token, "user": _row_to_user(user)})


@router.get("/api/auth/me")
async def current_user(request: Request):
    authed = current_request_user(request)
    with _connect() as conn:
        if _deepseen_auth_enabled():
            user = _deepseen_find_user(conn, authed["id"])
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            return {"user": _deepseen_row_to_user(user)}
        user = _find_user(conn, authed["id"])
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        out = _row_to_user(user)
        out["requiresCredentialChange"] = (
            user["username"] == DEFAULT_USERNAME and _verify_password(DEFAULT_PASSWORD, user["password_hash"])
        )
        return {"user": out}


@router.get("/api/auth/avatar")
async def get_avatar(request: Request):
    authed = current_request_user(request)
    with _connect() as conn:
        if _deepseen_auth_enabled():
            user = _deepseen_find_user(conn, authed["id"])
            return {"avatar": (_deepseen_avatar(user) if user else "") or ""}
        user = _find_user(conn, authed["id"])
        return {"avatar": (user["avatar"] if user else "") or ""}


@router.put("/api/auth/avatar")
async def update_avatar(request: Request, body: AvatarBody):
    authed = current_request_user(request)
    candidate = body.avatar if body.avatar is not None else {}
    avatar_json = validate_avatar(candidate)
    with _connect() as conn:
        if _deepseen_auth_enabled():
            parsed = json.loads(avatar_json)
            image_value = parsed.get("dataUrl") if parsed.get("type") == "image" else None
            conn.execute('UPDATE "User" SET image = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ?', (image_value, authed["id"]))
            conn.commit()
            return {"success": True, "avatar": avatar_json}
        conn.execute("UPDATE users SET avatar = ?, updated_at = ? WHERE id = ?", (avatar_json, _now_ms(), authed["id"]))
        conn.commit()
    return {"success": True, "avatar": avatar_json}


@router.post("/api/auth/setup")
async def setup_password():
    raise HTTPException(status_code=400, detail="Password login is managed by user accounts")


@router.post("/api/auth/change-password")
async def change_password(request: Request, body: PasswordBody):
    if _deepseen_auth_enabled():
        raise HTTPException(status_code=403, detail="Password changes are managed by DeepSeen.")
    if len(body.newPassword) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    authed = current_request_user(request)
    with _connect() as conn:
        user = _find_user(conn, authed["id"])
        if not user or not _verify_password(body.currentPassword, user["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (_hash_password(body.newPassword), _now_ms(), authed["id"]),
        )
        conn.commit()
    return {"success": True}


@router.post("/api/auth/change-username")
async def change_username(request: Request, body: UsernameBody):
    if _deepseen_auth_enabled():
        raise HTTPException(status_code=403, detail="Account profile changes are managed by DeepSeen.")
    new_username = body.newUsername.strip()
    if len(new_username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters")
    authed = current_request_user(request)
    with _connect() as conn:
        user = _find_user(conn, authed["id"])
        if not user or not _verify_password(body.currentPassword, user["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        existing = _find_user_by_username(conn, new_username)
        if existing and int(existing["id"]) != int(authed["id"]):
            raise HTTPException(status_code=409, detail="Username already exists")
        conn.execute("UPDATE users SET username = ?, updated_at = ? WHERE id = ?", (new_username, _now_ms(), authed["id"]))
        conn.commit()
    return {"success": True}


@router.delete("/api/auth/password")
async def remove_password():
    raise HTTPException(status_code=400, detail="Password login cannot be removed for user accounts")


def _normalize_role(value: Any) -> UserRole:
    if value not in {"super_admin", "admin"}:
        raise HTTPException(status_code=400, detail="Invalid role or status")
    return value


def _normalize_status(value: Any) -> UserStatus:
    if value not in {"active", "disabled"}:
        raise HTTPException(status_code=400, detail="Invalid role or status")
    return value


def _validate_profiles(profiles: List[str]) -> None:
    available = set(_list_profile_names())
    missing = next((p for p in profiles if p not in available), None)
    if missing:
        raise HTTPException(status_code=400, detail=f'Profile "{missing}" does not exist')


@router.get("/api/auth/users")
async def list_managed_users(request: Request):
    require_super_admin(request)
    with _connect() as conn:
        if _deepseen_auth_enabled():
            rows = conn.execute(
                'SELECT * FROM "User" ORDER BY "createdAt" ASC'
            ).fetchall()
            return {"users": [_deepseen_row_to_user(row) for row in rows], "profiles": _list_profile_names()}
        return {"users": _list_users(conn), "profiles": _list_profile_names()}


@router.post("/api/auth/users")
async def create_managed_user(request: Request, body: ManagedUserBody):
    if _deepseen_auth_enabled():
        raise HTTPException(status_code=403, detail="User management is managed by DeepSeen.")
    require_super_admin(request)
    username = (body.username or "").strip()
    password = body.password or ""
    role = _normalize_role(body.role or "admin")
    status = _normalize_status(body.status or "active")
    profiles = list(dict.fromkeys([p.strip() for p in (body.profiles or []) if p.strip()]))
    if len(username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    _validate_profiles(profiles)
    with _connect() as conn:
        if _find_user_by_username(conn, username):
            raise HTTPException(status_code=409, detail="Username already exists")
        user = _create_user(conn, username, password, role, status, profiles, body.defaultProfile)
        return JSONResponse(status_code=201, content={"user": _row_to_user(user), "users": _list_users(conn)})


@router.put("/api/auth/users/{user_id}")
async def update_managed_user(user_id: int, request: Request, body: ManagedUserBody):
    if _deepseen_auth_enabled():
        raise HTTPException(status_code=403, detail="User management is managed by DeepSeen.")
    authed = require_super_admin(request)
    with _connect() as conn:
        user = _find_user(conn, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        username = body.username.strip() if body.username is not None else user["username"]
        if len(username) < 2:
            raise HTTPException(status_code=400, detail="Username must be at least 2 characters")
        if body.password is not None and body.password and len(body.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        role = _normalize_role(body.role) if body.role is not None else user["role"]
        status = _normalize_status(body.status) if body.status is not None else user["status"]
        if user_id == int(authed["id"]) and status != "active":
            raise HTTPException(status_code=400, detail="You cannot disable your own account")
        if user["role"] == "super_admin" and user["status"] == "active" and (
            role != "super_admin" or status != "active"
        ) and _count_active_super_admins(conn, user_id) == 0:
            raise HTTPException(status_code=400, detail="At least one active super administrator is required")
        existing = _find_user_by_username(conn, username)
        if existing and int(existing["id"]) != user_id:
            raise HTTPException(status_code=409, detail="Username already exists")
        password_hash = _hash_password(body.password) if body.password else user["password_hash"]
        conn.execute(
            """
            UPDATE users SET username = ?, password_hash = ?, role = ?, status = ?, updated_at = ?
            WHERE id = ?
            """,
            (username, password_hash, role, status, _now_ms(), user_id),
        )
        if body.profiles is not None:
            profiles = list(dict.fromkeys([p.strip() for p in body.profiles if p.strip()]))
            _validate_profiles(profiles)
            _replace_user_profiles(conn, user_id, [] if role == "super_admin" else profiles, body.defaultProfile)
        conn.commit()
        return {"user": _row_to_user(_find_user(conn, user_id)), "users": _list_users(conn)}


@router.delete("/api/auth/users/{user_id}")
async def delete_managed_user(user_id: int, request: Request):
    if _deepseen_auth_enabled():
        raise HTTPException(status_code=403, detail="User management is managed by DeepSeen.")
    authed = require_super_admin(request)
    if user_id == int(authed["id"]):
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    with _connect() as conn:
        user = _find_user(conn, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if user["role"] == "super_admin" and user["status"] == "active" and _count_active_super_admins(conn, user_id) == 0:
            raise HTTPException(status_code=400, detail="At least one active super administrator is required")
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return {"success": True, "users": _list_users(conn)}


@router.get("/api/auth/locked-ips")
async def list_locked_ips(request: Request):
    current_request_user(request)
    return {"locks": _locked_ips()}


@router.delete("/api/auth/locked-ips")
async def unlock_ip_handler(request: Request):
    current_request_user(request)
    ip = request.query_params.get("ip")
    count = _unlock_ip(ip)
    if ip and count == 0:
        raise HTTPException(status_code=404, detail="IP not locked")
    return {"success": True, "count": count}
