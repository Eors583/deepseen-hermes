from hermes_cli.inventory import _apply_model_picker_filters


def test_model_picker_filters_hide_configured_providers_and_models(monkeypatch):
    rows = [
        {
            "slug": "openai-api",
            "models": ["gpt-4o-mini", "broken-model"],
            "total_models": 2,
            "pricing": {"gpt-4o-mini": {"input": "$0.15"}, "broken-model": {"input": "$9"}},
            "capabilities": {"gpt-4o-mini": {"fast": False}, "broken-model": {"fast": True}},
            "unavailable_models": ["broken-model"],
        },
        {
            "slug": "gemini",
            "models": ["gemini-3.1-flash-lite"],
            "total_models": 1,
        },
    ]

    monkeypatch.setattr(
        "hermes_cli.config.load_config",
        lambda: {
            "model_picker": {
                "hidden_providers": ["gemini"],
                "hidden_models": {"openai-api": ["broken-model"]},
            }
        },
    )

    _apply_model_picker_filters(rows)

    assert rows == [
        {
            "slug": "openai-api",
            "models": ["gpt-4o-mini"],
            "total_models": 1,
            "pricing": {"gpt-4o-mini": {"input": "$0.15"}},
            "capabilities": {"gpt-4o-mini": {"fast": False}},
            "unavailable_models": [],
        }
    ]
