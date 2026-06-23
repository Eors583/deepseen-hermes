"""Regression tests for retiring legacy dashboard password login.

Herbound product login is the FastAPI/JWT ``/api/auth/login`` path. The
historical dashboard-auth ``/auth/password-login`` flow is intentionally not
registered or rendered anymore.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from hermes_cli import web_server
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
