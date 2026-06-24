from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

from hermes_cli.config import get_env_value
from hermes_cli.deepseen_credentials import ensure_deepseen_api_key

_PLUGIN_DIR = Path(__file__).resolve().parent
_RUNNER = _PLUGIN_DIR / "deepseen_runner.mjs"
_TOOLSET = "crossborder_deepseen"
_DEFAULT_TIMEOUT_MS = 7200000
_VIDEO_TIMEOUT_MS = 7200000
_VIDEO_ACTIONS = {"smart_video", "video_recreation"}


def _is_deepseen_configurable() -> bool:
    return True


def _deepseen_user_key() -> str:
    try:
        from gateway.session_context import get_session_env

        value = str(get_session_env("HERMES_WEB_USER_ID", "") or "").strip()
        if value:
            return value
    except Exception:
        pass
    return str(os.environ.get("HERMES_DEEPSEEN_USER_KEY") or "").strip()


def _deepseen_api_key() -> str:
    return ensure_deepseen_api_key(_deepseen_user_key())


def _has_deepseen_key() -> bool:
    return bool(_deepseen_api_key())


def _runner_env() -> dict[str, str]:
    env = os.environ.copy()
    api_key = _deepseen_api_key()
    if api_key:
        env["DEEPSEEN_API_KEY"] = api_key
    else:
        env.pop("DEEPSEEN_API_KEY", None)
    for name in ("DEEPSEEN_BASE_URL", "DEEPSEEN_SDK_PATH"):
        value = str(env.get(name) or get_env_value(name) or "").strip()
        if value:
            env[name] = value
    return env


def _emit_progress(
    action: str,
    frame: dict[str, Any],
    progress_callback: Callable | None,
) -> None:
    if not progress_callback:
        return
    status = str(frame.get("status") or frame.get("phase") or "running")
    message = str(frame.get("message") or status)
    preview = f"{action}: {message}"
    try:
        progress_callback(
            "tool.progress",
            f"deepseen_{action}",
            preview,
            None,
            action=action,
            status=status,
            phase=frame.get("phase"),
            progress=frame.get("progress"),
            stage=frame.get("stage"),
            message=message,
            output_urls=frame.get("output_urls"),
            error=frame.get("error"),
        )
    except Exception:
        pass


def _call_runner(action: str, args: dict[str, Any], progress_callback: Callable | None = None) -> str:
    if not _has_deepseen_key():
        return json.dumps(
            {
                "ok": False,
                "error": {
                    "code": "missing_api_key",
                    "message": "DeepSeen API Key is not configured in Web Settings.",
                },
            },
            ensure_ascii=False,
        )
    node = shutil.which("node")
    if not node:
        return json.dumps(
            {
                "ok": False,
                "error": {
                    "code": "node_not_found",
                    "message": "Node.js >=18 is required to call deepseen-sdk.",
                },
            },
            ensure_ascii=False,
        )
    default_timeout_ms = _VIDEO_TIMEOUT_MS if action in _VIDEO_ACTIONS else _DEFAULT_TIMEOUT_MS
    timeout_ms = args.get("timeout_ms")
    try:
        timeout_s = max(30, int(timeout_ms or default_timeout_ms) / 1000 + 90)
    except (TypeError, ValueError):
        timeout_s = default_timeout_ms / 1000 + 90
    proc = subprocess.Popen(
        [node, str(_RUNNER), action],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(Path(__file__).resolve().parents[2]),
        env=_runner_env(),
    )
    stdout_queue: queue.Queue[str | None] = queue.Queue()
    stderr_chunks: list[str] = []

    def _read_stdout() -> None:
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                stdout_queue.put(line)
        finally:
            stdout_queue.put(None)

    def _read_stderr() -> None:
        assert proc.stderr is not None
        stderr_chunks.append(proc.stderr.read() or "")

    threading.Thread(target=_read_stdout, daemon=True).start()
    threading.Thread(target=_read_stderr, daemon=True).start()
    assert proc.stdin is not None
    proc.stdin.write(json.dumps(args, ensure_ascii=False))
    proc.stdin.close()

    started_at = time.monotonic()
    _emit_progress(
        action,
        {
            "phase": "starting",
            "status": "starting",
            "message": "正在启动 DeepSeen SDK 调用",
            "progress": 0,
            "elapsed_seconds": 0,
        },
        progress_callback,
    )
    final_payload: dict[str, Any] | None = None
    raw_lines: list[str] = []
    stdout_done = False
    last_heartbeat = started_at
    while not stdout_done:
        now = time.monotonic()
        elapsed = now - started_at
        if elapsed > timeout_s:
            proc.kill()
            _emit_progress(
                action,
                {
                    "phase": "timeout",
                    "status": "timeout",
                    "message": "DeepSeen SDK 调用超时",
                    "elapsed_seconds": int(elapsed),
                },
                progress_callback,
            )
            return json.dumps(
                {
                    "ok": False,
                    "error": {
                        "code": "runner_timeout",
                        "message": f"DeepSeen runner exceeded {int(timeout_s)} seconds.",
                    },
                },
                ensure_ascii=False,
            )
        try:
            line = stdout_queue.get(timeout=0.5)
        except queue.Empty:
            now = time.monotonic()
            if now - last_heartbeat >= 5:
                last_heartbeat = now
                _emit_progress(
                    action,
                    {
                        "phase": "waiting",
                        "status": "running",
                        "message": f"DeepSeen SDK 正在处理，已运行 {int(now - started_at)} 秒",
                        "elapsed_seconds": int(now - started_at),
                    },
                    progress_callback,
                )
            if proc.poll() is not None:
                continue
            continue
        if line is None:
            stdout_done = True
            break
        text = line.strip()
        if not text:
            continue
        raw_lines.append(text)
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and parsed.get("__deepseen_progress"):
            _emit_progress(action, parsed, progress_callback)
            continue
        if isinstance(parsed, dict):
            final_payload = parsed
    status = proc.wait(timeout=5)
    if final_payload is not None:
        if status != 0:
            final_payload.setdefault("ok", False)
        return _format_runner_payload(final_payload)
    stdout = "\n".join(raw_lines).strip()
    return json.dumps(
        {
            "ok": False,
            "error": {
                "code": "runner_failed",
                "status": status,
                "message": ("".join(stderr_chunks) or stdout or "DeepSeen runner failed").strip(),
            },
        },
        ensure_ascii=False,
    )


def _format_runner_payload(payload: dict[str, Any]) -> str:
    """Return the model-facing DeepSeen result.

    The SDK may return large nested business objects. The runner already
    converts those objects into a readable Markdown view; expose that as the
    primary tool result so the assistant does not paste raw SDK JSON back to
    the user.
    """
    if payload.get("ok") is False:
        return json.dumps(
            {
                "ok": False,
                "error": payload.get("error") or {
                    "code": "deepseen_failed",
                    "message": "DeepSeen SDK call failed",
                },
            },
            ensure_ascii=False,
        )

    markdown = str(
        payload.get("display_markdown")
        or payload.get("user_visible_summary")
        or ""
    ).strip()
    output_urls = payload.get("output_urls")
    if isinstance(output_urls, list) and output_urls:
        url_lines = [str(url).strip() for url in output_urls if str(url).strip()]
        if url_lines:
            urls_md = "\n".join(f"- {url}" for url in url_lines)
            markdown = f"{markdown}\n\n输出链接:\n{urls_md}".strip() if markdown else f"输出链接:\n{urls_md}"

    if markdown:
        return markdown

    return "DeepSeen 已完成，但没有返回可展示的业务内容。"


def _handler(action: str) -> Callable:
    return lambda args, **_kw: _call_runner(action, args or {}, _kw.get("tool_progress_callback"))


def _schema(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    common = {
        "poll_interval_ms": {"type": "integer", "description": "Polling interval in milliseconds. Default 8000."},
        "timeout_ms": {"type": "integer", "description": "Task timeout in milliseconds. Default 7200000 (2 hours)."},
    }
    return {
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": {**properties, **common},
            "required": required,
        },
    }


def _media_common() -> dict[str, Any]:
    return {
        "region": {"type": "string", "description": "Target market, for example US, United States, UK, EU."},
        "local_paths": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Server-visible local product image paths. The tool uploads them through DeepSeen first.",
        },
        "asset_urls": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Already uploaded OSS/CDN image URLs only. For local image files use local_paths/product_local_paths so the tool can upload them.",
        },
        "product_images": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Public product image URLs only. Do not put local file paths here.",
        },
        "product_file_ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "DeepSeen file IDs already returned by prior uploads.",
        },
        "include_prompts": {"type": "boolean", "description": "Whether SDK should include revised prompts when supported."},
        "metadata": {"type": "object", "additionalProperties": {"type": "string"}},
        "webhook_url": {"type": "string"},
        "idempotency_key": {"type": "string"},
    }


_TOOLS: tuple[tuple[str, str, dict[str, Any], list[str], str], ...] = (
    (
        "deepseen_smart_image_create_and_wait",
        "Generate cross-border ecommerce listing/product/marketing images with DeepSeen SDK. Use for main images, listing images, scene images, and product image generation. Return user_visible_summary/user_visible_fields to the user; do not paste raw SDK JSON.",
        {
            **_media_common(),
            "keywords": {"type": "string", "description": "English product keywords or concise product title."},
            "product_details": {"type": "string", "description": "Selling points, material, style, audience, usage scenario."},
        },
        ["keywords"],
        "smart_image",
    ),
    (
        "deepseen_smart_video_create_and_wait",
        "Generate cross-border ecommerce marketing short videos with DeepSeen SDK. Use for product videos, TikTok ad creatives, and short selling videos. Video jobs default to a 2-hour wait timeout.",
        {
            **_media_common(),
            "product_title": {"type": "string", "description": "Product title or core selling point."},
            "count": {"type": "integer", "description": "Number of videos to generate. Default 1."},
            "model": {"type": "string", "description": "Video model, for example Veo8s, Grok10s, SeeDance15s."},
        },
        ["product_title"],
        "smart_video",
    ),
    (
        "deepseen_image_recreation_create_and_wait",
        "Create benchmark/recreated product images from a competitor product link plus own product images. Use for TikTok Shop competitor images and image recreation.",
        {
            **_media_common(),
            "competitor_product_url": {"type": "string", "description": "Competitor product URL, usually a TikTok Shop product link."},
            "model": {"type": "string"},
            "aspect_ratio": {"type": "string", "description": "Image aspect ratio, for example 9:16, 1:1, 4:5."},
            "auto_generate": {"type": "boolean", "description": "Whether to generate after analysis. Default is SDK default."},
            "auto_confirm": {"type": "boolean", "description": "Confirm awaiting_confirmation jobs automatically. Default true."},
            "confirm_model": {"type": "string"},
        },
        ["competitor_product_url"],
        "image_recreation",
    ),
    (
        "deepseen_video_recreation_create_and_wait",
        "Create benchmark/recreated short videos from a competitor/reference video plus own product images. Use for TikTok video recreation and reference-video based generation. Video recreation jobs default to a 2-hour wait timeout.",
        {
            **_media_common(),
            "competitor_video_url": {"type": "string", "description": "TikTok/Douyin/video URL or already uploaded reference video URL only. Do not put local file paths here."},
            "reference_video_local_path": {"type": "string", "description": "Server-visible local reference video path, for example D:\\path\\video.mp4. Use this for local videos; the tool uploads it first."},
            "product_local_paths": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Local product base image paths, for example D:\\path\\image.png. The tool uploads them first.",
            },
            "model": {"type": "string"},
            "group_count": {"type": "integer"},
            "auto_generate": {"type": "boolean"},
            "auto_confirm": {"type": "boolean", "description": "Confirm awaiting_confirmation jobs automatically. Default true."},
            "confirm_model": {"type": "string"},
        },
        [],
        "video_recreation",
    ),
    (
        "deepseen_product_report_create_and_wait",
        "Generate a product operation report for cross-border ecommerce: selection, market, pricing, stock, supplier, and patent risk analysis.",
        {
            "product_name": {"type": "string"},
            "target_market": {"type": "string"},
            "target_audience": {"type": "string"},
            "platform": {"type": "string"},
            "selling_points": {"type": "string"},
            "purchase_cost": {"type": "number"},
            "expected_price": {"type": "number"},
            "weight_kg": {"type": "number"},
            "dimensions_cm": {"type": "string"},
            "planned_stock_units": {"type": "integer"},
            "restock_cycle": {"type": "string"},
            "supplier_count": {"type": "integer"},
            "enable_patent_search": {"type": "boolean"},
            "local_paths": {"type": "array", "items": {"type": "string"}},
            "asset_urls": {"type": "array", "items": {"type": "string"}},
            "product_image_urls": {"type": "array", "items": {"type": "string"}},
            "product_images": {"type": "array", "items": {"type": "string"}},
        },
        ["product_name", "target_market"],
        "product_report",
    ),
    (
        "deepseen_competitor_analyze_and_wait",
        "Analyze one competitor product URL with DeepSeen SDK. Present user_visible_summary/user_visible_fields in a readable layout; do not paste raw SDK JSON.",
        {"product_url": {"type": "string"}, "region": {"type": "string"}},
        ["product_url"],
        "competitor_single",
    ),
    (
        "deepseen_competitor_analyze_multi_and_wait",
        "Run multi-competitor research by product keyword with DeepSeen SDK. Present user_visible_summary/user_visible_fields in a readable layout; do not paste raw SDK JSON.",
        {"product_keyword": {"type": "string"}, "region": {"type": "string"}},
        ["product_keyword"],
        "competitor_multi",
    ),
    (
        "deepseen_creator_analyze_and_wait",
        "Analyze creator persona and collaboration strategy for a product and target market. Present user_visible_summary/user_visible_fields in a readable layout; do not paste raw SDK JSON.",
        {
            "product_name": {"type": "string", "description": "产品名称。Ask the user as '产品名称', not as this parameter name."},
            "target_market": {"type": "string", "description": "目标市场，例如 US/美国/欧洲。Ask the user as '目标市场'."},
            "target_product_price": {"type": "string", "description": "目标售价或价格带，可选。Ask as '目标售价或价格带'."},
            "category_level1": {"type": "string", "description": "一级类目，可选。Ask as '一级类目'."},
            "category_level2": {"type": "string", "description": "二级类目，可选。Ask as '二级类目'."},
            "competitor_name": {"type": "string", "description": "竞品名称，可选。Ask as '竞品名称'."},
            "target_user_age": {"type": "string", "description": "目标用户年龄段，可选。Ask as '目标用户年龄段'."},
            "target_user_gender": {"type": "string", "description": "目标用户性别，可选。Ask as '目标用户性别'."},
            "sample_tier": {"type": "string", "enum": ["light", "standard", "deep"], "description": "分析深度，可选：轻量、标准、深度。Ask as '分析深度'."},
        },
        ["product_name", "target_market"],
        "creator_analysis",
    ),
    (
        "deepseen_creator_score_and_wait",
        "Score and rank creators for a product. Provide rows or an uploaded/OSS file URL. Present user_visible_summary/user_visible_fields in a readable layout; do not paste raw SDK JSON.",
        {
            "product_name": {"type": "string"},
            "target_market": {"type": "string"},
            "target_product_price": {"type": "string"},
            "category_level1": {"type": "string"},
            "category_level2": {"type": "string"},
            "uploaded_file_url": {"type": "string"},
            "local_file_path": {"type": "string", "description": "Server-visible local CSV/XLSX file path to upload first."},
            "standard_selection_mode": {"type": "string", "enum": ["AUTO", "LATEST_OWN", "RECENT_OWN", "MANUAL"]},
            "standard_id": {"type": "string"},
            "rows": {"type": "array", "items": {"type": "object"}},
        },
        ["product_name", "target_market"],
        "creator_score",
    ),
    (
        "deepseen_video_analysis_create_and_wait",
        "Analyze a video for structure, selling points, script, reusable ecommerce creative elements, and reasons for virality. Present user_visible_summary/user_visible_fields in a readable layout; do not paste raw SDK JSON.",
        {
            "source": {"type": "string", "enum": ["LINK", "UPLOAD"]},
            "source_url": {"type": "string"},
            "video_url": {"type": "string"},
            "local_video_path": {"type": "string", "description": "Server-visible local video path; used when source is UPLOAD."},
            "target_market": {"type": "string"},
            "title": {"type": "string"},
        },
        ["source"],
        "video_analysis",
    ),
)


def register(ctx) -> None:
    for name, description, properties, required, action in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset=_TOOLSET,
            schema=_schema(name, description, properties, required),
            handler=_handler(action),
            check_fn=_is_deepseen_configurable,
            requires_env=[],
            description=description,
        )
