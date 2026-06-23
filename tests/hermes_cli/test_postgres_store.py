import pytest

from hermes_cli import postgres_store


def test_require_postgres_url_lists_supported_env_vars(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / ".hermes"))
    for key in postgres_store.POSTGRES_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)

    with pytest.raises(RuntimeError) as exc:
        postgres_store.require_postgres_url()

    message = str(exc.value)
    assert "PostgreSQL is required" in message
    for key in postgres_store.POSTGRES_ENV_KEYS:
        assert key in message


def test_database_url_reads_project_hermes_env(monkeypatch, tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    (home / ".env").write_text(
        "HERMES_DATABASE_URL=postgresql://hermes:test@127.0.0.1:55432/hermes\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    for key in postgres_store.POSTGRES_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)

    assert postgres_store.database_url() == "postgresql://hermes:test@127.0.0.1:55432/hermes"


def test_pg_compat_row_supports_name_and_index_access():
    row = postgres_store.PgCompatRow({"count": 3, "name": "demo"})

    assert row["count"] == 3
    assert row[0] == 3
    assert row["name"] == "demo"
    assert row[1] == "demo"


class _FakeCursor:
    rowcount = 1

    def __init__(self, rows):
        self._rows = list(rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


def test_pg_compat_cursor_wraps_dict_rows():
    cursor = postgres_store.PgCompatCursor(_FakeCursor([{"id": 42}]))

    row = cursor.fetchone()

    assert row["id"] == 42
    assert row[0] == 42
