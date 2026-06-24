"""Regression tests for retiring legacy dashboard password login.

Herbound product login is the FastAPI/JWT ``/api/auth/login`` path. The
historical dashboard-auth ``/auth/password-login`` flow is intentionally not
registered or rendered anymore.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import bcrypt
from hermes_cli import web_server
from hermes_cli import web_auth
from hermes_cli.dashboard_auth import (
    DashboardAuthProvider,
    InvalidCredentialsError,
    ProviderError,
    Session,
    assert_protocol_compliance,
    clear_providers,
    register_provider,
)
from hermes_cli.dashboard_auth.login_page import render_login_html
from tests.hermes_cli.conftest_dashboard_auth import StubAuthProvider

pytestmark = pytest.mark.xdist_group("dashboard_auth_app_state")


class PasswordProvider(DashboardAuthProvider):
    """Legacy in-test provider that still imports but is not exposed."""

    name = "testpw"
    display_name = "Test Password"
    supports_password = True

    def start_login(self, *, redirect_uri: str):
        raise NotImplementedError

    def complete_login(self, **kwargs):
        raise NotImplementedError

    def complete_password_login(self, *, username: str, password: str) -> Session:
        if username != "admin" or password != "hunter2":
            raise InvalidCredentialsError("bad creds")
        raise ProviderError("legacy password login is not used")

    def verify_session(self, *, access_token: str):
        return None

    def refresh_session(self, *, refresh_token: str) -> Session:
        raise ProviderError("not implemented")

    def revoke_session(self, *, refresh_token: str) -> None:
        return None


@pytest.fixture
def gated_app():
    clear_providers()
    register_provider(PasswordProvider())
    prev_host = getattr(web_server.app.state, "bound_host", None)
    prev_port = getattr(web_server.app.state, "bound_port", None)
    prev_required = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.bound_host = "fly-app.fly.dev"
    web_server.app.state.bound_port = 443
    web_server.app.state.auth_required = True
    client = TestClient(web_server.app, base_url="https://fly-app.fly.dev")
    yield client
    clear_providers()
    web_server.app.state.bound_host = prev_host
    web_server.app.state.bound_port = prev_port
    web_server.app.state.auth_required = prev_required


def test_legacy_password_provider_still_satisfies_protocol():
    assert assert_protocol_compliance(PasswordProvider) is None
    assert StubAuthProvider.supports_password is False


def test_providers_endpoint_never_advertises_password_login(gated_app):
    resp = gated_app.get("/api/auth/providers")
    assert resp.status_code == 200
    providers = {p["name"]: p for p in resp.json()["providers"]}
    assert providers["testpw"]["supports_password"] is False


def test_login_page_does_not_render_password_form():
    clear_providers()
    register_provider(PasswordProvider())
    try:
        html = render_login_html(next_path="/sessions")
        assert "/auth/password-login" not in html
        assert "<form" not in html
        assert 'href="/auth/login?provider=testpw' in html
    finally:
        clear_providers()


def test_legacy_password_login_route_is_not_available(gated_app):
    resp = gated_app.post(
        "/auth/password-login",
        json={
            "provider": "testpw",
            "username": "admin",
            "password": "hunter2",
        },
        follow_redirects=False,
    )
    assert resp.status_code in {302, 404, 405}


class _FakeCursor:
    def __init__(self, rows):
        self._rows = list(rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class _FakeDeepSeenConnection:
    def __init__(self, user):
        self.user = user
        self.updated_last_login = False
        self.updated_refresh_token = False

    def execute(self, sql, params=None):
        if 'COUNT(*) FROM "User"' in sql:
            return _FakeCursor([{"count": 1}])
        if 'lower(email) = lower(?)' in sql:
            return _FakeCursor([self.user] if params and params[0].lower() == self.user["email"].lower() else [])
        if 'WHERE id = ?' in sql and 'FROM "User"' in sql:
            return _FakeCursor([self.user] if params and params[0] == self.user["id"] else [])
        if 'UPDATE "User"' in sql and '"lastLoginAt"' in sql:
            self.updated_last_login = True
            if '"refreshToken"' in sql and params:
                self.updated_refresh_token = True
                self.user["refreshToken"] = params[0]
            return _FakeCursor([])
        raise AssertionError(f"unexpected SQL: {sql}")

    def commit(self):
        return None

    def rollback(self):
        return None

    def close(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()


def test_deepseen_auth_mode_uses_deepseen_user_table(monkeypatch):
    password_hash = bcrypt.hashpw(b"secret123", bcrypt.gensalt()).decode("utf-8")
    conn = _FakeDeepSeenConnection(
        {
            "id": "deepseen-user-1",
            "email": "user@example.com",
            "name": "Example User",
            "password": password_hash,
            "role": "USER",
            "status": "ACTIVE",
            "image": None,
            "createdAt": None,
            "updatedAt": None,
            "lastLoginAt": None,
            "refreshToken": "existing-refresh-token",
        }
    )
    monkeypatch.setenv("HERBOUND_AUTH_PROVIDER", "deepseen")
    monkeypatch.setattr(web_auth.postgres_store, "connect", lambda: conn)
    monkeypatch.setattr(web_auth, "_jwt_secret", lambda: b"test-secret")

    assert web_auth._deepseen_count_users(web_auth._connect()) == 1
    row = web_auth._deepseen_find_login_user(conn, "USER@example.com")
    assert row["id"] == "deepseen-user-1"
    assert web_auth._deepseen_verify_password("secret123", row["password"]) is True

    token = web_auth._issue_jwt(web_auth._deepseen_auth_user(row))
    authed = web_auth.authenticate_bearer_token(token)
    assert authed == {
        "id": "deepseen-user-1",
        "username": "user@example.com",
        "role": "user",
        "email": "user@example.com",
        "display_name": "Example User",
    }

    payload = web_auth._verify_jwt(token)
    assert payload is not None
    assert payload["userId"] == "deepseen-user-1"
    assert payload["email"] == "user@example.com"
    assert payload["type"] == "access"
    assert payload["iss"] == "viralforge"

    refresh_token = web_auth._issue_deepseen_refresh_token(web_auth._deepseen_auth_user(row))
    web_auth._deepseen_update_last_login(conn, "deepseen-user-1", refresh_token)
    assert conn.updated_last_login is True
    assert conn.updated_refresh_token is True
    assert conn.user["refreshToken"] == refresh_token

    conn.user["refreshToken"] = None
    assert web_auth.authenticate_bearer_token(token) is None
