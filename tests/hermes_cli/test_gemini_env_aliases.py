from hermes_cli.auth import resolve_api_key_provider_credentials


def test_gemini_accepts_yunwu_env_alias(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / ".hermes"))
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_BASE_URL", raising=False)
    monkeypatch.delenv("YUNWU_GEMINI_BASE_URL", raising=False)
    monkeypatch.setenv("YUNWU_GEMINI_API_KEY", "sk-yunwu-test")
    monkeypatch.setenv("GOOGLE_AI_BASE_URL", "https://yunwu.ai/v1beta")

    creds = resolve_api_key_provider_credentials("gemini")

    assert creds["api_key"] == "sk-yunwu-test"
    assert creds["base_url"] == "https://yunwu.ai/v1beta"
    assert creds["source"] == "YUNWU_GEMINI_API_KEY"
