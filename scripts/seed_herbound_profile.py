from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SEED_DIR = PROJECT_ROOT / "deploy" / "herbound"


def _hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME") or "/opt/data").expanduser()


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return data if isinstance(data, dict) else {}


def _dump_yaml(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(data, fh, allow_unicode=True, sort_keys=False)


def _ensure_list_item(data: dict[str, Any], path: tuple[str, ...], item: str) -> None:
    current: Any = data
    for key in path[:-1]:
        current = current.setdefault(key, {})
    values = current.setdefault(path[-1], [])
    if not isinstance(values, list):
        values = []
        current[path[-1]] = values
    if item not in values:
        values.append(item)


def _merge_config(home: Path) -> None:
    seed = _load_yaml(SEED_DIR / "config.yaml")
    target_path = home / "config.yaml"
    target = _load_yaml(target_path)

    for platform, toolsets in (seed.get("platform_toolsets") or {}).items():
        target.setdefault("platform_toolsets", {}).setdefault(platform, [])
        for toolset in toolsets or []:
            if toolset not in target["platform_toolsets"][platform]:
                target["platform_toolsets"][platform].append(toolset)

    _ensure_list_item(target, ("plugins", "enabled"), "crossborder-deepseen")

    target.setdefault("display", {})
    target["display"]["personality"] = "herbound"
    target["display"].setdefault("interface", "tui")
    target["display"]["final_response_markdown"] = "raw"

    target.setdefault("agent", {})
    target["agent"]["tool_use_enforcement"] = True
    target["agent"]["task_completion_guidance"] = True
    target["agent"].setdefault("personalities", {})
    target["agent"]["personalities"]["herbound"] = (
        seed.get("agent", {})
        .get("personalities", {})
        .get("herbound", {})
    )

    if "model" in seed:
        target_model = target.setdefault("model", {})
        if not isinstance(target_model, dict):
            target_model = {}
            target["model"] = target_model
        seed_model = seed.get("model") or {}
        for key in ("default", "provider", "base_url", "max_tokens"):
            if key in seed_model:
                target_model[key] = seed_model[key]

    if "model_picker" in seed:
        target["model_picker"] = seed["model_picker"]

    _dump_yaml(target_path, target)


def _copy_profile_files(home: Path) -> None:
    for rel in (
        Path("SOUL.md"),
        Path("skills") / "crossborder-deepseen" / "SKILL.md",
        Path("skills") / "crossborder-deepseen" / "DESCRIPTION.md",
    ):
        src = SEED_DIR / rel
        dst = home / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)


def main() -> None:
    home = _hermes_home()
    home.mkdir(parents=True, exist_ok=True)
    _merge_config(home)
    _copy_profile_files(home)


if __name__ == "__main__":
    main()
