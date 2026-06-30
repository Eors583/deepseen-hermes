"""KIE.AI provider routing helpers.

KIE exposes several chat models through model-specific endpoints instead of a
single OpenAI-compatible ``/v1`` base URL. Keep that mapping centralized so the
model picker, runtime resolver, and production desktop builds stay in sync.
"""

from __future__ import annotations

import os
from typing import Dict, TypedDict


DEFAULT_KIE_BASE_URL = "https://api.kie.ai"


class KieModelRoute(TypedDict):
    model: str
    path: str
    api_mode: str


KIE_MODEL_ROUTES: Dict[str, KieModelRoute] = {
    "gpt-5-5": {
        "model": "gpt-5-5",
        "path": "/codex/v1",
        "api_mode": "codex_responses",
    },
    "gemini-3.1-pro": {
        "model": "gemini-3.1-pro",
        "path": "/gemini-3.1-pro/v1",
        "api_mode": "chat_completions",
    },
    "claude-sonnet-4-6": {
        "model": "claude-sonnet-4-6",
        "path": "/claude",
        "api_mode": "anthropic_messages",
    },
    "claude-opus-4-8": {
        "model": "claude-opus-4-8",
        "path": "/claude",
        "api_mode": "anthropic_messages",
    },
}


KIE_MODEL_ALIASES: Dict[str, str] = {
    "gpt-5.5-pro": "gpt-5-5",
    "gpt-5-5-pro": "gpt-5-5",
    "openai/gpt-5.5-pro": "gpt-5-5",
    "openai/gpt-5-5": "gpt-5-5",
    "gemini-3.1-pro-preview": "gemini-3.1-pro",
    "google/gemini-3.1-pro-preview": "gemini-3.1-pro",
    "google/gemini-3.1-pro": "gemini-3.1-pro",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "anthropic/claude-sonnet-4.6": "claude-sonnet-4-6",
    "anthropic/claude-sonnet-4-6": "claude-sonnet-4-6",
    "claude-opus-4.8": "claude-opus-4-8",
    "anthropic/claude-opus-4.8": "claude-opus-4-8",
    "anthropic/claude-opus-4-8": "claude-opus-4-8",
}


def canonical_kie_model(model: str) -> str:
    key = str(model or "").strip().lower()
    return KIE_MODEL_ALIASES.get(key, key)


def kie_model_ids() -> list[str]:
    return list(KIE_MODEL_ROUTES.keys())


def kie_base_url() -> str:
    return (os.getenv("KIE_BASE_URL", "").strip() or DEFAULT_KIE_BASE_URL).rstrip("/")


def resolve_kie_route(model: str) -> tuple[str, str, str]:
    canonical = canonical_kie_model(model)
    route = KIE_MODEL_ROUTES.get(canonical)
    if not route:
        raise ValueError(f"KIE does not have a configured route for model '{model}'")
    base_url = f"{kie_base_url()}{route['path']}".rstrip("/")
    return canonical, base_url, route["api_mode"]
