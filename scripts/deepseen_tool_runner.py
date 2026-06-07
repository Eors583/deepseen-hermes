"""Unified CLI runner for the four agent-facing Deepseen tools.

Usage:
  python scripts/deepseen_tool_runner.py --list-tools
  python scripts/deepseen_tool_runner.py --manifest
  python scripts/deepseen_tool_runner.py deepseen_smart_image_recreations_create_and_wait < payload.json

The script reads one JSON object from stdin and routes it to the matching
Deepseen tool handler.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Dict

RUNNER_PROGRESS_PREFIX = "__DEEPSEEN_TOOL_PROGRESS__"

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.deepseen_tools import (  # noqa: E402
    DEEPSEEN_TOOL_NAMES,
    dispatch_deepseen_tool,
    get_deepseen_tool_manifest,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run one of the four supported Deepseen agent tools via JSON stdin."
    )
    parser.add_argument("tool_name", nargs="?", help="Exact Deepseen tool name to run")
    parser.add_argument(
        "--list-tools",
        action="store_true",
        help="Print the four supported Deepseen tool names",
    )
    parser.add_argument(
        "--manifest",
        action="store_true",
        help="Print tool->parameters manifest as JSON",
    )
    return parser.parse_args()


def _read_json_stdin() -> Dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise TypeError("stdin payload must be one JSON object")
    return data


def _emit_progress(progress: Dict[str, Any]) -> None:
    sys.stderr.write(f"{RUNNER_PROGRESS_PREFIX}{json.dumps(progress, ensure_ascii=False)}\n")
    sys.stderr.flush()


async def _main() -> int:
    args = _parse_args()
    if args.list_tools:
        print(json.dumps(list(DEEPSEEN_TOOL_NAMES), ensure_ascii=False, indent=2))
        return 0
    if args.manifest:
        print(json.dumps(get_deepseen_tool_manifest(), ensure_ascii=False, indent=2))
        return 0
    if not args.tool_name:
        raise SystemExit("Missing tool_name. Use --list-tools to inspect valid names.")
    if args.tool_name not in DEEPSEEN_TOOL_NAMES:
        raise SystemExit(
            f"Unsupported Deepseen tool: {args.tool_name}. "
            f"Valid names: {', '.join(DEEPSEEN_TOOL_NAMES)}"
        )

    payload = _read_json_stdin()
    result = await dispatch_deepseen_tool(
        args.tool_name,
        payload,
        tool_progress_callback=lambda *_args, **kwargs: _emit_progress(
            {
                "stage": kwargs.get("stage"),
                "progress": kwargs.get("progress"),
                "status": kwargs.get("status"),
                "text": kwargs.get("text"),
                "detail": kwargs.get("detail"),
                "timestamp": kwargs.get("timestamp"),
            }
        ),
    )
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
