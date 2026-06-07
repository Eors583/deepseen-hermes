"""Deepseen Open API 工具集 — Hermes 跨境电商内容创作工具。

四个主工具（agent-facing）：
  deepseen_smart_video_recreations_create_and_wait  视频智创
  deepseen_smart_image_recreations_create_and_wait  图片智创
  deepseen_image_recreations_create_and_wait        图片二创
  deepseen_video_recreations_create_and_wait        视频二创

鉴权：环境变量 DEEPSEEN_API_KEY（必填）
地址：环境变量 DEEPSEEN_BASE_URL（默认 https://deepseen.ai/v1）

扩展说明：
  新增工具只需：① 添加 _handle_xxx 异步函数 ② 添加 XXX_SCHEMA ③ 调用 registry.register()
  不需要改任何其他文件（registry 自动发现）。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from hermes_constants import get_hermes_dir
import uuid

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

_DEFAULT_BASE_URL = "https://deepseen.ai/v1"
_DEFAULT_POLL_INTERVAL_MS = 8_000
_DEFAULT_TIMEOUT_IMAGE_MS = 600_000
_DEFAULT_TIMEOUT_VIDEO_MS = 900_000
_SDK_BRIDGE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "deepseen_sdk_bridge.mjs"
_SDK_PROGRESS_PREFIX = "__DEEPSEEN_PROGRESS__"
_DEEPSEEN_TOOL_RUNNER_SCRIPT = "scripts/deepseen_tool_runner.py"
_DEEPSEEN_TOOL_RUNNER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "deepseen_tool_runner.py"
_RUNNER_PROGRESS_PREFIX = "__DEEPSEEN_TOOL_PROGRESS__"

DEEPSEEN_TOOL_NAMES = (
    "deepseen_smart_video_recreations_create_and_wait",
    "deepseen_smart_image_recreations_create_and_wait",
    "deepseen_image_recreations_create_and_wait",
    "deepseen_video_recreations_create_and_wait",
)


def _runner_hint(tool_name: str) -> str:
    return (
        f"INTERNAL RUNNER: Hermes starts `python {_DEEPSEEN_TOOL_RUNNER_SCRIPT} {tool_name}`"
        " and passes one JSON object on stdin.\n"
        "You MUST analyze the conversation first, then fill only this tool's defined JSON parameters."
        " Do NOT invent extra parameter names.\n"
    )


def _python_bin() -> str:
    return os.getenv("HERMES_AGENT_CLI_PYTHON") or os.getenv("PYTHON_BIN") or os.sys.executable

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------


def _get_config() -> tuple[str, str]:
    """返回 (base_url, api_key)，从环境变量读取。"""
    base_url = os.getenv("DEEPSEEN_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")
    api_key = os.getenv("DEEPSEEN_API_KEY", "")
    return base_url, api_key


def _check_deepseen_available() -> bool:
    _, api_key = _get_config()
    return bool(api_key.strip())


# ---------------------------------------------------------------------------
# SDK 桥接层
# ---------------------------------------------------------------------------


def _sdk_bridge_creationflags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


async def _run_sdk_bridge(action: str, payload: Dict[str, Any]) -> Any:
    if not _SDK_BRIDGE_PATH.exists():
        raise FileNotFoundError(f"deepseen sdk bridge not found: {_SDK_BRIDGE_PATH}")

    base_url, api_key = _get_config()
    progress_callback = payload.get("_progress_callback")
    payload_for_bridge = {key: value for key, value in payload.items() if key != "_progress_callback"}
    bridge_payload = {
        "baseURL": base_url,
        "apiKey": api_key,
        **payload_for_bridge,
    }

    process = await asyncio.create_subprocess_exec(
        os.getenv("NODE_BIN", "node"),
        str(_SDK_BRIDGE_PATH),
        action,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        creationflags=_sdk_bridge_creationflags(),
    )
    raw_payload = json.dumps(bridge_payload, ensure_ascii=False).encode("utf-8")
    assert process.stdin is not None
    process.stdin.write(raw_payload)
    await process.stdin.drain()
    process.stdin.close()

    stdout_chunks: List[bytes] = []
    stderr_messages: List[str] = []
    async def _consume_stdout() -> None:
        assert process.stdout is not None
        async for chunk in process.stdout:
            stdout_chunks.append(chunk)

    async def _consume_stderr() -> None:
        assert process.stderr is not None
        async for raw_line in process.stderr:
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line:
                continue
            if line.startswith(_SDK_PROGRESS_PREFIX):
                if callable(progress_callback):
                    raw_json = line[len(_SDK_PROGRESS_PREFIX) :].strip()
                    try:
                        progress_callback(json.loads(raw_json))
                    except Exception as exc:
                        logger.debug("Deepseen progress callback failed: %s", exc)
                continue
            stderr_messages.append(line)

    await asyncio.gather(_consume_stdout(), _consume_stderr())
    await process.wait()
    if process.returncode != 0:
        message = "\n".join(stderr_messages).strip() or b"".join(stdout_chunks).decode(
            "utf-8", errors="ignore"
        ).strip()
        raise RuntimeError(f"deepseen-sdk 调用失败: {message or f'exit {process.returncode}'}")

    output = b"".join(stdout_chunks).decode("utf-8", errors="ignore").strip()
    if not output:
        raise RuntimeError("deepseen-sdk 调用失败: empty response")
    return json.loads(output)


def _emit_tool_progress(
    tool_progress_callback: Any,
    function_name: str,
    function_args: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    progress: Optional[Dict[str, Any]] = None,
) -> None:
    if not callable(tool_progress_callback):
        return
    payload = progress or {}
    preview = str(payload.get("text") or payload.get("stage") or "Deepseen 处理中")
    try:
        tool_progress_callback(
            "tool.progress",
            function_name,
            preview,
            function_args,
            tool_call_id=tool_call_id or "",
            session_id=session_id or "",
            turn_id=turn_id or "",
            api_request_id=api_request_id or "",
            stage=payload.get("stage"),
            progress=payload.get("progress"),
            status=payload.get("status"),
            text=payload.get("text"),
            detail=payload,
            timestamp=payload.get("timestamp"),
        )
    except Exception as exc:
        logger.debug("Deepseen tool progress emit failed: %s", exc)


async def _run_deepseen_tool_runner(
    tool_name: str,
    tool_input: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    tool_progress_callback: Any = None,
) -> str:
    if not _DEEPSEEN_TOOL_RUNNER_PATH.exists():
        raise FileNotFoundError(f"deepseen tool runner not found: {_DEEPSEEN_TOOL_RUNNER_PATH}")

    process = await asyncio.create_subprocess_exec(
        _python_bin(),
        str(_DEEPSEEN_TOOL_RUNNER_PATH),
        tool_name,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        creationflags=_sdk_bridge_creationflags(),
    )
    raw_payload = json.dumps(tool_input, ensure_ascii=False).encode("utf-8")
    assert process.stdin is not None
    process.stdin.write(raw_payload)
    await process.stdin.drain()
    process.stdin.close()

    stdout_chunks: List[bytes] = []
    stderr_messages: List[str] = []

    async def _consume_stdout() -> None:
        assert process.stdout is not None
        async for chunk in process.stdout:
            stdout_chunks.append(chunk)

    async def _consume_stderr() -> None:
        assert process.stderr is not None
        async for raw_line in process.stderr:
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line:
                continue
            if line.startswith(_RUNNER_PROGRESS_PREFIX):
                raw_json = line[len(_RUNNER_PROGRESS_PREFIX) :].strip()
                try:
                    progress = json.loads(raw_json)
                    _emit_tool_progress(
                        tool_progress_callback,
                        tool_name,
                        tool_input,
                        tool_call_id=tool_call_id,
                        session_id=session_id,
                        turn_id=turn_id,
                        api_request_id=api_request_id,
                        progress=progress,
                    )
                except Exception as exc:
                    logger.debug("Deepseen runner progress parse failed: %s", exc)
                continue
            stderr_messages.append(line)

    await asyncio.gather(_consume_stdout(), _consume_stderr())
    await process.wait()
    output = b"".join(stdout_chunks).decode("utf-8", errors="ignore").strip()
    if process.returncode != 0:
        message = "\n".join(stderr_messages).strip() or output
        raise RuntimeError(f"deepseen tool runner failed: {message or f'exit {process.returncode}'}")
    if not output:
        raise RuntimeError("deepseen tool runner failed: empty response")
    return output


async def _http_upload(
    base_url: str,
    api_key: str,
    local_path: str,
    purpose: str = "product_image",
    progress_context: Optional[Dict[str, Any]] = None,
) -> Dict:
    """上传本地文件，返回 ApiFile（含 url、id）。"""
    path_obj = Path(local_path)
    if not path_obj.exists():
        raise FileNotFoundError(
            "文件不存在: "
            f"{local_path}. "
            "如果你是在浏览器/远程服务器上使用 Hermes，请先把素材作为附件上传，"
            "然后在工具参数里使用上传返回的服务器端 path。"
        )

    return await _run_sdk_bridge(
        "upload",
        {
            "filePath": str(path_obj),
            "purpose": purpose,
            **(progress_context or {}),
        },
    )
# ---------------------------------------------------------------------------
# 文件上传辅助：local_paths → remote URLs
# ---------------------------------------------------------------------------

def _coerce_media_path(value: Any) -> Tuple[str, Optional[str]]:
    if value is None:
        raise TypeError("path is None")
    if isinstance(value, str):
        return value, None
    if isinstance(value, dict):
        for key in ("path", "file_path", "absolutePath", "absolute_path", "url"):
            raw = value.get(key)
            if isinstance(raw, str) and raw.strip():
                media_type = value.get("media_type") if isinstance(value.get("media_type"), str) else None
                return raw, media_type
    return str(value), None


def _extract_media_reference(value: Any) -> Dict[str, Optional[str]]:
    result: Dict[str, Optional[str]] = {
        "path": None,
        "url": None,
        "file_id": None,
        "media_type": None,
    }
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("http://") or text.startswith("https://"):
            result["url"] = text
        elif text:
            result["path"] = text
        return result
    if isinstance(value, dict):
        for key in ("resource_file_id", "file_id", "resourceFileId"):
            raw = value.get(key)
            if isinstance(raw, str) and raw.strip():
                result["file_id"] = raw.strip()
                break
        for key in ("resource_url", "url", "resourceUrl"):
            raw = value.get(key)
            if isinstance(raw, str) and raw.strip():
                result["url"] = raw.strip()
                break
        for key in ("path", "file_path", "absolutePath", "absolute_path"):
            raw = value.get(key)
            if isinstance(raw, str) and raw.strip():
                result["path"] = raw.strip()
                break
        media_type = value.get("media_type")
        if isinstance(media_type, str) and media_type.strip():
            result["media_type"] = media_type.strip()
        return result
    text = str(value).strip()
    if text.startswith("http://") or text.startswith("https://"):
        result["url"] = text
    elif text:
        result["path"] = text
    return result


async def _resolve_local_paths(
    base_url: str,
    api_key: str,
    local_paths: Optional[List[Any]],
    purpose: str = "product_image",
) -> List[str]:
    """上传所有本地路径，返回远端 URL 列表。"""
    if not local_paths:
        return []
    urls = []
    for lp in local_paths:
        lp, _media_type = _coerce_media_path(lp)
        lp = lp.strip()
        if lp.startswith("http://") or lp.startswith("https://"):
            urls.append(lp)
        else:
            logger.debug("上传本地文件: %s (purpose=%s)", lp, purpose)
            api_file = await _http_upload(base_url, api_key, lp, purpose)
            urls.append(api_file["url"])
    return urls


async def _resolve_local_paths_with_meta(
    base_url: str,
    api_key: str,
    local_paths: Optional[List[Any]],
    purpose: str = "product_image",
) -> Tuple[List[str], List[Dict[str, Any]]]:
    if not local_paths:
        return [], []
    urls: List[str] = []
    uploaded: List[Dict[str, Any]] = []
    for lp in local_paths:
        lp, _media_type = _coerce_media_path(lp)
        lp = lp.strip()
        if lp.startswith("http://") or lp.startswith("https://"):
            urls.append(lp)
            uploaded.append({"input": lp, "purpose": purpose, "kind": "remote_url", "url": lp})
            continue
        logger.debug("上传本地文件: %s (purpose=%s)", lp, purpose)
        api_file = await _http_upload(base_url, api_key, lp, purpose)
        urls.append(api_file["url"])
        uploaded.append(
            {
                "input": lp,
                "purpose": purpose,
                "kind": "uploaded_file",
                "file_id": api_file.get("id"),
                "url": api_file.get("url"),
                "filename": api_file.get("filename"),
                "content_type": api_file.get("content_type"),
                "bytes": api_file.get("bytes"),
            }
        )
    return urls, uploaded


async def _collect_media_inputs(
    base_url: str,
    api_key: str,
    values: Optional[List[Any]],
    purpose: str = "product_image",
    progress_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, List[Any]]:
    result: Dict[str, List[Any]] = {
        "urls": [],
        "file_ids": [],
        "uploaded": [],
    }
    if not values:
        return result
    for value in values:
        ref = _extract_media_reference(value)
        if ref["file_id"]:
            result["file_ids"].append(ref["file_id"])
        if ref["url"]:
            result["urls"].append(ref["url"])
            result["uploaded"].append(
                {
                    "input": ref["url"],
                    "purpose": purpose,
                    "kind": "remote_url",
                    "url": ref["url"],
                    **({"file_id": ref["file_id"]} if ref["file_id"] else {}),
                }
            )
            continue
        if ref["path"]:
            logger.debug("上传本地文件: %s (purpose=%s)", ref["path"], purpose)
            api_file = await _http_upload(base_url, api_key, ref["path"], purpose, progress_context)
            result["urls"].append(api_file["url"])
            result["file_ids"].append(api_file["id"])
            result["uploaded"].append(
                {
                    "input": ref["path"],
                    "purpose": purpose,
                    "kind": "uploaded_file",
                    "file_id": api_file.get("id"),
                    "url": api_file.get("url"),
                    "filename": api_file.get("filename"),
                    "content_type": api_file.get("content_type"),
                    "bytes": api_file.get("bytes"),
                }
            )
    return result


# ---------------------------------------------------------------------------
# 结果格式化
# ---------------------------------------------------------------------------

async def _download_to_local(url: str, job_type: str) -> str:
    """Download the output url to a local file in cache/deepseen."""
    from urllib.parse import urlparse
    import os
    
    path = urlparse(url).path
    ext = os.path.splitext(path)[1]
    if not ext:
        if job_type in ["image", "smart-image"]:
            ext = ".png"
        else:
            ext = ".mp4"
            
    cache_dir = get_hermes_dir("cache/deepseen", "downloads")
    cache_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = cache_dir / f"{uuid.uuid4().hex}{ext}"
    
    try:
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.get(url, follow_redirects=True)
            resp.raise_for_status()
            file_path.write_bytes(resp.content)
            return str(file_path.absolute())
    except Exception as e:
        logger.warning(f"Failed to download deepseen output {url}: {e}")
        return url


async def _format_result_async(job: Dict, *, input_files: Optional[List[Dict[str, Any]]] = None) -> str:
    """将 MediaJob 格式化为 agent 友好的文本，并下载结果文件。"""
    outputs = job.get("outputs") or []
    job_id = job.get("id", "")
    job_type = job.get("type", "")
    sdk_trace = job.get("_trace") if isinstance(job.get("_trace"), list) else []

    if not outputs:
        return json.dumps(
            {
                "job_id": job_id,
                "type": job_type,
                "status": job.get("status"),
                "outputs": [],
                **({"sdk_trace": sdk_trace} if sdk_trace else {}),
            },
            ensure_ascii=False,
            indent=2,
        )

    local_paths = []
    output_urls = []
    for o in outputs:
        url = o.get("url")
        if url:
            output_urls.append(url)
            local_path = await _download_to_local(url, job_type)
            local_paths.append(local_path)
            o["local_path"] = local_path

    agent_summary = {
        "job_id": job_id,
        "type": job_type,
        "status": job.get("status"),
        "output_count": len(outputs),
        "output_urls": output_urls,
        "local_paths": local_paths,
        **({"input_files": input_files} if input_files else {}),
        **({"sdk_trace": sdk_trace} if sdk_trace else {}),
        "outputs": [
            {
                "index": o.get("index"),
                "variant_id": o.get("variant_id"),
                "kind": o.get("kind"),
                "url": o.get("url"),
                "local_path": o.get("local_path"),
                **({"revised_prompt": o["revised_prompt"]} if o.get("revised_prompt") else {}),
            }
            for o in outputs
        ],
    }
    return json.dumps({"agent_summary": agent_summary}, ensure_ascii=False, indent=2)


def _format_error(err: Exception) -> str:
    return json.dumps({"error": str(err)}, ensure_ascii=False, indent=2)


def _build_progress_context(
    function_name: str,
    function_args: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    tool_progress_callback: Any = None,
) -> Dict[str, Any]:
    return {
        "_progress_callback": lambda progress: _emit_tool_progress(
            tool_progress_callback,
            function_name,
            function_args,
            tool_call_id=tool_call_id,
            session_id=session_id,
            turn_id=turn_id,
            api_request_id=api_request_id,
            progress=progress,
        )
    }


# ===========================================================================
# 工具一：视频智创
# ===========================================================================

SMART_VIDEO_CREATE_AND_WAIT_SCHEMA = {
    "name": "deepseen_smart_video_recreations_create_and_wait",
    "description": (
        _runner_hint("deepseen_smart_video_recreations_create_and_wait")
        +
        "【视频智创】从产品标题/产品图生成营销短视频（TikTok / 跨境电商投放素材）。\n"
        "必填 product_title；有本地产品图传 local_paths（自动上传）。\n"
        "内部完成 upload / 创建 / 轮询，返回 agent_summary。包含 output_urls 和 local_paths。\n"
        "IMPORTANT: Do NOT use `vision_analyze` or `video_analyze` to preview the local files before calling this tool. Pass the paths directly.\n"
        "CRITICAL: If the user provides an image/video via attachment (Base64) but does NOT provide the exact local absolute path, you MUST refuse to generate and explicitly ASK the user to provide the absolute path as plain text (e.g., C:/...). You CANNOT use this tool without the local path.\n"
        "CRITICAL: DO NOT WRITE PYTHON SCRIPTS (e.g., moviepy) to process videos locally. You MUST ONLY use this tool `deepseen_smart_video_recreations_create_and_wait` to process the video.\n"
        "IMPORTANT: The Web UI often sends file attachments in a structured format containing the absolute path (e.g. `{\"path\": \"C:\\\\...\\\\file.mp4\"}`). You MUST extract this `path` string and pass it directly to this tool's `reference_video_local_path` or `product_local_paths` arguments.\n"
        "IMPORTANT: You MUST display the generated media to the user using Markdown link syntax: `[Generated Video](local_path)`. Do NOT use `![video](local_path)` as the UI cannot render it properly."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "product_title": {
                "type": "string",
                "description": "产品标题或核心卖点，如 Wireless Bluetooth Earbuds",
            },
            "region": {
                "type": "string",
                "description": "目标市场区域，如 美国、日本、东南亚",
                "default": "美国",
            },
            "local_paths": {
                "type": "array",
                "items": {"oneOf": [{"type": "string"}, {"type": "object"}]},
                "description": "本地产品图路径列表（支持绝对路径或 HTTPS URL），桥接层自动上传",
            },
            "product_images": {
                "type": "array",
                "items": {"type": "string"},
                "description": "已有远端产品图 URL（与 local_paths 二选一或混用）",
            },
            "product_file_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "已上传文件的 file_id 列表",
            },
            "count": {
                "type": "integer",
                "description": "生成视频数量",
                "default": 1,
            },
            "model": {
                "type": "string",
                "description": "视频模型，可选 Veo8s / Veo8s_official / Veo8s*2 / Grok10s / SeeDance15s",
                "default": "Veo8s",
            },
            "poll_interval_ms": {"type": "integer", "default": 8000},
            "timeout_ms": {"type": "integer", "default": 900000},
        },
        "required": ["product_title"],
    },
}


async def _handle_smart_video_create_and_wait(
    tool_input: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    tool_progress_callback: Any = None,
) -> str:
    base_url, api_key = _get_config()
    try:
        progress_context = _build_progress_context(
            "deepseen_smart_video_recreations_create_and_wait",
            tool_input,
            tool_call_id=tool_call_id,
            session_id=session_id,
            turn_id=turn_id,
            api_request_id=api_request_id,
            tool_progress_callback=tool_progress_callback,
        )
        media_inputs = await _collect_media_inputs(
            base_url, api_key, tool_input.get("local_paths"), "product_image", progress_context
        )
        create_params: Dict[str, Any] = {
            "region": tool_input.get("region", "美国"),
            "productTitle": tool_input["product_title"],
            "count": tool_input.get("count", 1),
            "model": tool_input.get("model", "Veo8s"),
            "includePrompts": False,
        }
        product_images = media_inputs["urls"] + list(tool_input.get("product_images") or [])
        product_file_ids = media_inputs["file_ids"] + list(tool_input.get("product_file_ids") or [])
        if product_images:
            create_params["productImages"] = product_images
        if product_file_ids:
            create_params["productFileIds"] = product_file_ids

        result = await _run_sdk_bridge(
            "smart-video-create-and-wait",
            {
                "createParams": create_params,
                "pollIntervalMs": tool_input.get("poll_interval_ms", _DEFAULT_POLL_INTERVAL_MS),
                "timeoutMs": tool_input.get("timeout_ms", _DEFAULT_TIMEOUT_VIDEO_MS),
                **progress_context,
            },
        )
        return await _format_result_async(result, input_files=media_inputs["uploaded"])
    except Exception as exc:
        logger.exception("视频智创失败")
        return _format_error(exc)


# ===========================================================================
# 工具二：图片智创
# ===========================================================================

SMART_IMAGE_CREATE_AND_WAIT_SCHEMA = {
    "name": "deepseen_smart_image_recreations_create_and_wait",
    "description": (
        _runner_hint("deepseen_smart_image_recreations_create_and_wait")
        +
        "【图片智创】按英文关键词生成 Listing 主图 / 产品图（Amazon / TikTok Shop）。\n"
        "必填 keywords；有本地产品图传 local_paths（自动上传）。\n"
        "内部完成 upload / 创建 / 轮询，返回 agent_summary。包含 output_urls 和 local_paths。\n"
        "IMPORTANT: Do NOT use `vision_analyze` or `video_analyze` to preview the local files before calling this tool. Pass the paths directly.\n"
        "CRITICAL: If the user provides an image/video via attachment (Base64) but does NOT provide the exact local absolute path, you MUST refuse to generate and explicitly ASK the user to provide the absolute path as plain text (e.g., C:/...). You CANNOT use this tool without the local path.\n"
        "CRITICAL: DO NOT WRITE PYTHON SCRIPTS (e.g., PIL/OpenCV) to process images locally. You MUST ONLY use this tool `deepseen_smart_image_recreations_create_and_wait` to process the image.\n"
        "IMPORTANT: The Web UI often sends file attachments in a structured format containing the absolute path (e.g. `{\"path\": \"C:\\\\...\\\\file.png\"}`). You MUST extract this `path` string and pass it directly to this tool's arguments.\n"
        "IMPORTANT: You MUST display the generated media to the user using Markdown syntax: `![image](local_path)`. Use the `local_paths` from the result."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "keywords": {
                "type": "string",
                "description": "英文关键词，如 Men cotton t-shirt",
            },
            "region": {
                "type": "string",
                "description": "目标市场区域，如 美国、日本",
                "default": "美国",
            },
            "local_paths": {
                "type": "array",
                "items": {"oneOf": [{"type": "string"}, {"type": "object"}]},
                "description": "本地产品图路径（自动上传）",
            },
            "product_images": {
                "type": "array",
                "items": {"type": "string"},
                "description": "已有远端产品图 URL",
            },
            "product_file_ids": {
                "type": "array",
                "items": {"type": "string"},
            },
            "product_details": {
                "type": "string",
                "description": "产品附加描述，可提升出图质量",
            },
            "poll_interval_ms": {"type": "integer", "default": 8000},
            "timeout_ms": {"type": "integer", "default": 600000},
        },
        "required": ["keywords"],
    },
}


async def _handle_smart_image_create_and_wait(
    tool_input: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    tool_progress_callback: Any = None,
) -> str:
    base_url, api_key = _get_config()
    try:
        progress_context = _build_progress_context(
            "deepseen_smart_image_recreations_create_and_wait",
            tool_input,
            tool_call_id=tool_call_id,
            session_id=session_id,
            turn_id=turn_id,
            api_request_id=api_request_id,
            tool_progress_callback=tool_progress_callback,
        )
        media_inputs = await _collect_media_inputs(
            base_url, api_key, tool_input.get("local_paths"), "product_image", progress_context
        )
        create_params: Dict[str, Any] = {
            "region": tool_input.get("region", "美国"),
            "keywords": tool_input["keywords"],
            "includePrompts": False,
        }
        product_images = media_inputs["urls"] + list(tool_input.get("product_images") or [])
        product_file_ids = media_inputs["file_ids"] + list(tool_input.get("product_file_ids") or [])
        if product_images:
            create_params["productImages"] = product_images
        if product_file_ids:
            create_params["productFileIds"] = product_file_ids
        if tool_input.get("product_details"):
            create_params["productDetails"] = tool_input["product_details"]

        result = await _run_sdk_bridge(
            "smart-image-create-and-wait",
            {
                "createParams": create_params,
                "pollIntervalMs": tool_input.get("poll_interval_ms", _DEFAULT_POLL_INTERVAL_MS),
                "timeoutMs": tool_input.get("timeout_ms", _DEFAULT_TIMEOUT_IMAGE_MS),
                **progress_context,
            },
        )
        return await _format_result_async(result, input_files=media_inputs["uploaded"])
    except Exception as exc:
        logger.exception("图片智创失败")
        return _format_error(exc)


# ===========================================================================
# 工具三：图片二创
# ===========================================================================

IMAGE_RECREATION_CREATE_AND_WAIT_SCHEMA = {
    "name": "deepseen_image_recreations_create_and_wait",
    "description": (
        _runner_hint("deepseen_image_recreations_create_and_wait")
        +
        "【图片二创】竞品 TikTok Shop / Amazon 链接 + 自家产品图对标出图。\n"
        "必填 competitor_product_url；产品图用 local_paths（自动上传）。\n"
        "内部完成 upload / 创建 / 轮询 / 自动确认，返回 agent_summary。包含 output_urls 和 local_paths。\n"
        "IMPORTANT: Do NOT use `vision_analyze` or `video_analyze` to preview the local files before calling this tool. Pass the paths directly.\n"
        "CRITICAL: If the user provides an image/video via attachment (Base64) but does NOT provide the exact local absolute path, you MUST refuse to generate and explicitly ASK the user to provide the absolute path as plain text (e.g., C:/...). You CANNOT use this tool without the local path.\n"
        "CRITICAL: DO NOT WRITE PYTHON SCRIPTS (e.g., PIL/OpenCV) to process images locally. You MUST ONLY use this tool `deepseen_image_recreations_create_and_wait` to process the image.\n"
        "IMPORTANT: The Web UI often sends file attachments in a structured format containing the absolute path (e.g. `{\"path\": \"C:\\\\...\\\\file.png\"}`). You MUST extract this `path` string and pass it directly to this tool's arguments.\n"
        "IMPORTANT: You MUST display the generated media to the user using Markdown syntax: `![image](local_path)`. Use the `local_paths` from the result."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "competitor_product_url": {
                "type": "string",
                "description": "竞品商品链接，如 https://shop.tiktok.com/... 或 Amazon ASIN 页面",
            },
            "local_paths": {
                "type": "array",
                "items": {"oneOf": [{"type": "string"}, {"type": "object"}]},
                "description": "自家产品图本地路径（自动上传）",
            },
            "product_images": {
                "type": "array",
                "items": {"type": "string"},
                "description": "已有远端产品图 URL",
            },
            "product_file_ids": {
                "type": "array",
                "items": {"type": "string"},
            },
            "model": {
                "type": "string",
                "description": "图片模型",
                "default": "nano-banana-2",
            },
            "aspect_ratio": {
                "type": "string",
                "description": "输出比例，如 9:16 / 1:1",
                "default": "9:16",
            },
            "auto_generate": {"type": "boolean", "default": True},
            "auto_confirm": {
                "type": "boolean",
                "description": "分析完成后是否自动确认生成（默认 true）",
                "default": True,
            },
            "poll_interval_ms": {"type": "integer", "default": 8000},
            "timeout_ms": {"type": "integer", "default": 600000},
        },
        "required": ["competitor_product_url"],
    },
}


async def _handle_image_recreation_create_and_wait(
    tool_input: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    tool_progress_callback: Any = None,
) -> str:
    base_url, api_key = _get_config()
    try:
        progress_context = _build_progress_context(
            "deepseen_image_recreations_create_and_wait",
            tool_input,
            tool_call_id=tool_call_id,
            session_id=session_id,
            turn_id=turn_id,
            api_request_id=api_request_id,
            tool_progress_callback=tool_progress_callback,
        )
        media_inputs = await _collect_media_inputs(
            base_url, api_key, tool_input.get("local_paths"), "product_image", progress_context
        )
        create_params: Dict[str, Any] = {
            "competitorProductUrl": tool_input["competitor_product_url"],
            "autoGenerate": tool_input.get("auto_generate", True),
            "includePrompts": False,
        }
        product_images = media_inputs["urls"] + list(tool_input.get("product_images") or [])
        product_file_ids = media_inputs["file_ids"] + list(tool_input.get("product_file_ids") or [])
        if product_images:
            create_params["productImages"] = product_images
        if product_file_ids:
            create_params["productFileIds"] = product_file_ids
        if tool_input.get("model"):
            create_params["model"] = tool_input["model"]
        if tool_input.get("aspect_ratio"):
            create_params["aspectRatio"] = tool_input["aspect_ratio"]

        result = await _run_sdk_bridge(
            "image-create-and-wait",
            {
                "createParams": create_params,
                "pollIntervalMs": tool_input.get("poll_interval_ms", _DEFAULT_POLL_INTERVAL_MS),
                "timeoutMs": tool_input.get("timeout_ms", _DEFAULT_TIMEOUT_IMAGE_MS),
                "autoConfirm": tool_input.get("auto_confirm", True),
                **progress_context,
            },
        )
        return await _format_result_async(result, input_files=media_inputs["uploaded"])
    except Exception as exc:
        logger.exception("图片二创失败")
        return _format_error(exc)


# ===========================================================================
# 工具四：视频二创
# ===========================================================================

VIDEO_RECREATION_CREATE_AND_WAIT_SCHEMA = {
    "name": "deepseen_video_recreations_create_and_wait",
    "description": (
        _runner_hint("deepseen_video_recreations_create_and_wait")
        +
        "【视频二创】参考爆款视频 + 产品底图复刻营销短视频。\n"
        "两种模式：\n"
        "A) competitor_video_url（TikTok/抖音链接或视频 URL）+ product_local_paths（产品底图）；\n"
        "B) reference_video_local_path（本地参考视频，自动上传）+ product_local_paths。\n"
        "内部完成 upload / 创建 / 轮询 / 自动确认，返回 agent_summary。包含 output_urls 和 local_paths。\n"
        "IMPORTANT: Do NOT use `vision_analyze` or `video_analyze` to preview the local files before calling this tool. Pass the paths directly.\n"
        "CRITICAL: If the user provides an image/video via attachment (Base64) but does NOT provide the exact local absolute path, you MUST refuse to generate and explicitly ASK the user to provide the absolute path as plain text (e.g., C:/...). You CANNOT use this tool without the local path.\n"
        "CRITICAL: DO NOT WRITE PYTHON SCRIPTS (e.g., moviepy) to process videos locally. You MUST ONLY use this tool `deepseen_video_recreations_create_and_wait` to process the video.\n"
        "IMPORTANT: The Web UI often sends file attachments in a structured format containing the absolute path (e.g. `{\"path\": \"C:\\\\...\\\\file.mp4\"}`). You MUST extract this `path` string and pass it directly to this tool's `reference_video_local_path` or `product_local_paths` arguments.\n"
        "IMPORTANT: You MUST display the generated media to the user using Markdown link syntax: `[Generated Video](local_path)`. Do NOT use `![video](local_path)` as the UI cannot render it properly."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "competitor_video_url": {
                "type": "string",
                "description": "TikTok/抖音视频链接，或已有参考视频的 HTTPS URL（.mp4/.webm/.mov）",
            },
            "reference_video_local_path": {
                "oneOf": [{"type": "string"}, {"type": "object"}],
                "description": "本地参考视频路径；桥接层自动上传后作为 competitor_video_url",
            },
            "product_local_paths": {
                "type": "array",
                "items": {"oneOf": [{"type": "string"}, {"type": "object"}]},
                "description": "产品底图本地路径（必填至少 1 张，自动上传）",
            },
            "local_paths": {
                "type": "array",
                "items": {"oneOf": [{"type": "string"}, {"type": "object"}]},
                "description": "兼容字段，等同 product_local_paths（产品底图）",
            },
            "product_images": {
                "type": "array",
                "items": {"type": "string"},
                "description": "已有远端产品底图 URL",
            },
            "product_file_ids": {
                "type": "array",
                "items": {"type": "string"},
            },
            "model": {"type": "string", "description": "视频模型"},
            "group_count": {
                "type": "integer",
                "description": "生成组数",
                "default": 1,
            },
            "auto_confirm": {
                "type": "boolean",
                "description": "分析完成后自动确认生成",
                "default": True,
            },
            "poll_interval_ms": {"type": "integer", "default": 8000},
            "timeout_ms": {"type": "integer", "default": 900000},
        },
        "required": [],
    },
}


async def _handle_video_recreation_create_and_wait(
    tool_input: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    tool_progress_callback: Any = None,
) -> str:
    base_url, api_key = _get_config()
    try:
        progress_context = _build_progress_context(
            "deepseen_video_recreations_create_and_wait",
            tool_input,
            tool_call_id=tool_call_id,
            session_id=session_id,
            turn_id=turn_id,
            api_request_id=api_request_id,
            tool_progress_callback=tool_progress_callback,
        )
        # 产品底图：优先 product_local_paths，兼容 local_paths
        raw_product_paths = (
            tool_input.get("product_local_paths")
            or tool_input.get("local_paths")
            or []
        )
        product_media_inputs = await _collect_media_inputs(
            base_url, api_key, raw_product_paths, "product_image", progress_context
        )
        product_images = product_media_inputs["urls"] + list(tool_input.get("product_images") or [])
        product_file_ids = product_media_inputs["file_ids"] + list(tool_input.get("product_file_ids") or [])

        # 参考视频：本地路径优先于直接 URL
        competitor_video_url = tool_input.get("competitor_video_url")
        ref_value = tool_input.get("reference_video_local_path")
        uploaded_ref_file: Optional[Dict[str, Any]] = None
        if ref_value:
            ref_media = _extract_media_reference(ref_value)
            if ref_media["url"]:
                competitor_video_url = ref_media["url"]
                uploaded_ref_file = {
                    "input": ref_media["url"],
                    "purpose": "reference_video",
                    "kind": "remote_url",
                    "url": ref_media["url"],
                    **({"file_id": ref_media["file_id"]} if ref_media["file_id"] else {}),
                }
            elif ref_media["path"]:
                logger.debug("上传本地参考视频: %s", ref_media["path"])
                api_file = await _http_upload(base_url, api_key, ref_media["path"], "reference_video", progress_context)
                competitor_video_url = api_file["url"]
                uploaded_ref_file = {
                    "input": ref_media["path"],
                    "purpose": "reference_video",
                    "kind": "uploaded_file",
                    "file_id": api_file.get("id"),
                    "url": api_file.get("url"),
                    "filename": api_file.get("filename"),
                    "content_type": api_file.get("content_type"),
                    "bytes": api_file.get("bytes"),
                }

        if not competitor_video_url:
            return _format_error(
                ValueError(
                    "请提供 competitor_video_url（TikTok/抖音链接或视频URL）"
                    " 或 reference_video_local_path（本地参考视频路径）"
                )
            )

        create_params: Dict[str, Any] = {
            "competitorVideoUrl": competitor_video_url,
            "autoGenerate": True,
            "groupCount": tool_input.get("group_count", 1),
            "includePrompts": False,
        }
        if product_images:
            create_params["productImages"] = product_images
        if product_file_ids:
            create_params["productFileIds"] = product_file_ids
        if tool_input.get("model"):
            create_params["model"] = tool_input["model"]

        result = await _run_sdk_bridge(
            "video-create-and-wait",
            {
                "createParams": create_params,
                "pollIntervalMs": tool_input.get("poll_interval_ms", _DEFAULT_POLL_INTERVAL_MS),
                "timeoutMs": tool_input.get("timeout_ms", _DEFAULT_TIMEOUT_VIDEO_MS),
                "autoConfirm": tool_input.get("auto_confirm", True),
                **progress_context,
            },
        )
        input_files = list(product_media_inputs["uploaded"])
        if uploaded_ref_file:
            input_files.append(uploaded_ref_file)
        return await _format_result_async(result, input_files=input_files)
    except Exception as exc:
        logger.exception("视频二创失败")
        return _format_error(exc)


def get_deepseen_tool_manifest() -> Dict[str, Dict[str, Any]]:
    schemas = {
        "deepseen_smart_video_recreations_create_and_wait": SMART_VIDEO_CREATE_AND_WAIT_SCHEMA,
        "deepseen_smart_image_recreations_create_and_wait": SMART_IMAGE_CREATE_AND_WAIT_SCHEMA,
        "deepseen_image_recreations_create_and_wait": IMAGE_RECREATION_CREATE_AND_WAIT_SCHEMA,
        "deepseen_video_recreations_create_and_wait": VIDEO_RECREATION_CREATE_AND_WAIT_SCHEMA,
    }
    manifest: Dict[str, Dict[str, Any]] = {}
    for tool_name, schema in schemas.items():
        parameters = schema.get("parameters", {}) if isinstance(schema, dict) else {}
        properties = parameters.get("properties", {}) if isinstance(parameters, dict) else {}
        manifest[tool_name] = {
            "script_command": f"python {_DEEPSEEN_TOOL_RUNNER_SCRIPT} {tool_name}",
            "required": list(parameters.get("required", []) or []),
            "properties": sorted(properties.keys()),
            "description": str(schema.get("description", "")),
        }
    return manifest


async def dispatch_deepseen_tool(
    tool_name: str,
    tool_input: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    tool_progress_callback: Any = None,
) -> str:
    handlers = {
        "deepseen_smart_video_recreations_create_and_wait": _handle_smart_video_create_and_wait,
        "deepseen_smart_image_recreations_create_and_wait": _handle_smart_image_create_and_wait,
        "deepseen_image_recreations_create_and_wait": _handle_image_recreation_create_and_wait,
        "deepseen_video_recreations_create_and_wait": _handle_video_recreation_create_and_wait,
    }
    handler = handlers.get(tool_name)
    if handler is None:
        raise ValueError(f"Unsupported Deepseen tool: {tool_name}")
    return await handler(
        tool_input,
        tool_call_id=tool_call_id,
        session_id=session_id,
        turn_id=turn_id,
        api_request_id=api_request_id,
        tool_progress_callback=tool_progress_callback,
    )


async def _handle_smart_video_create_and_wait_via_runner(
    tool_input: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    tool_progress_callback: Any = None,
) -> str:
    return await _run_deepseen_tool_runner(
        "deepseen_smart_video_recreations_create_and_wait",
        tool_input,
        tool_call_id=tool_call_id,
        session_id=session_id,
        turn_id=turn_id,
        api_request_id=api_request_id,
        tool_progress_callback=tool_progress_callback,
    )


async def _handle_smart_image_create_and_wait_via_runner(
    tool_input: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    tool_progress_callback: Any = None,
) -> str:
    return await _run_deepseen_tool_runner(
        "deepseen_smart_image_recreations_create_and_wait",
        tool_input,
        tool_call_id=tool_call_id,
        session_id=session_id,
        turn_id=turn_id,
        api_request_id=api_request_id,
        tool_progress_callback=tool_progress_callback,
    )


async def _handle_image_recreation_create_and_wait_via_runner(
    tool_input: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    tool_progress_callback: Any = None,
) -> str:
    return await _run_deepseen_tool_runner(
        "deepseen_image_recreations_create_and_wait",
        tool_input,
        tool_call_id=tool_call_id,
        session_id=session_id,
        turn_id=turn_id,
        api_request_id=api_request_id,
        tool_progress_callback=tool_progress_callback,
    )


async def _handle_video_recreation_create_and_wait_via_runner(
    tool_input: Dict[str, Any],
    *,
    tool_call_id: str = "",
    session_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    tool_progress_callback: Any = None,
) -> str:
    return await _run_deepseen_tool_runner(
        "deepseen_video_recreations_create_and_wait",
        tool_input,
        tool_call_id=tool_call_id,
        session_id=session_id,
        turn_id=turn_id,
        api_request_id=api_request_id,
        tool_progress_callback=tool_progress_callback,
    )


# ===========================================================================
# 注册到 Hermes registry
# ===========================================================================

from tools.registry import registry  # noqa: E402

registry.register(
    name="deepseen_smart_video_recreations_create_and_wait",
    toolset="deepseen",
    schema=SMART_VIDEO_CREATE_AND_WAIT_SCHEMA,
    handler=_handle_smart_video_create_and_wait_via_runner,
    check_fn=_check_deepseen_available,
    is_async=True,
    emoji="🎬",
    description="视频智创：产品标题/产品图 → 营销短视频",
)

registry.register(
    name="deepseen_smart_image_recreations_create_and_wait",
    toolset="deepseen",
    schema=SMART_IMAGE_CREATE_AND_WAIT_SCHEMA,
    handler=_handle_smart_image_create_and_wait_via_runner,
    check_fn=_check_deepseen_available,
    is_async=True,
    emoji="🖼️",
    description="图片智创：英文关键词 → Listing 产品图",
)

registry.register(
    name="deepseen_image_recreations_create_and_wait",
    toolset="deepseen",
    schema=IMAGE_RECREATION_CREATE_AND_WAIT_SCHEMA,
    handler=_handle_image_recreation_create_and_wait_via_runner,
    check_fn=_check_deepseen_available,
    is_async=True,
    emoji="🎨",
    description="图片二创：竞品链接 + 自家产品图对标出图",
)

registry.register(
    name="deepseen_video_recreations_create_and_wait",
    toolset="deepseen",
    schema=VIDEO_RECREATION_CREATE_AND_WAIT_SCHEMA,
    handler=_handle_video_recreation_create_and_wait_via_runner,
    check_fn=_check_deepseen_available,
    is_async=True,
    emoji="📹",
    description="视频二创：参考爆款视频 + 产品底图 → 复刻营销视频",
)
