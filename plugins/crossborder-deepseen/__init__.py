from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import quote
from typing import Any, Callable

from hermes_cli.config import get_env_value
from hermes_cli.deepseen_credentials import ensure_deepseen_api_key
from hermes_constants import get_hermes_home

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
        return "DeepSeen 任务未完成\n\nDeepSeen 使用凭证未配置，请联系管理员确认账号授权或数据服务配置。"
    node = shutil.which("node")
    if not node:
        return "DeepSeen 任务未完成\n\n当前运行环境缺少必要组件，请联系管理员检查服务部署。"
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
        return _format_runner_payload(final_payload, action)
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


def _format_runner_payload(payload: dict[str, Any], action: str = "result") -> str:
    """Return the model-facing DeepSeen result.

    The SDK may return large nested business objects. The runner already
    converts those objects into a readable Markdown view; expose that as the
    primary tool result so the assistant does not paste raw SDK JSON back to
    the user.
    """
    if payload.get("ok") is False:
        error = _sanitize_deepseen_error(payload.get("error") or {
            "code": "deepseen_failed",
            "message": "DeepSeen SDK call failed",
        })
        message = str(error.get("message") or "DeepSeen 任务未完成，请稍后重试。").strip()
        return f"DeepSeen 任务未完成\n\n{message}".strip()

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
        return _with_report_download(action, markdown, payload)

    return _with_report_download(action, "DeepSeen 已完成，但没有返回可展示的业务摘要。", payload)


def _sanitize_deepseen_error(error: Any) -> dict[str, Any]:
    if not isinstance(error, dict):
        return {
            "code": "deepseen_failed",
            "message": "DeepSeen 任务未完成，请稍后重试或联系管理员检查数据配置。",
        }
    out = dict(error)
    message = str(out.get("message") or "")
    if re.search(r"FastMoss|OpenBoost|API\s*error|接口|endpoint|provider", message, re.IGNORECASE):
        out["message"] = "DeepSeen 数据服务暂时无法完成本次分析，请稍后重试或联系管理员检查数据配置。"
    elif re.search(r"参数错误|invalid|missing|required", message, re.IGNORECASE):
        out["message"] = "提交的信息不完整或格式不符合要求，请检查产品名称、目标市场、商品链接、图片或视频等必要信息后重试。"
    return out


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


_ACTION_LABELS = {
    "smart_image": "智能图片生成",
    "smart_video": "智能视频生成",
    "image_recreation": "图片复刻",
    "video_recreation": "视频复刻",
    "product_report": "选品分析",
    "competitor_analysis": "竞品分析",
    "competitor_multi": "多竞品分析",
    "creator_analysis": "达人分析",
    "creator_rank": "达人排序",
    "video_analysis": "视频分析",
}


_REPORT_SECTION_LABELS = {
    "name": "产品名称",
    "productName": "产品名称",
    "product_name": "产品名称",
    "targetMarket": "目标市场",
    "target_market": "目标市场",
    "targetAudience": "目标人群",
    "target_audience": "目标人群",
    "sellingPoints": "核心卖点",
    "selling_points": "核心卖点",
    "verdictScore": "综合评分",
    "verdict_score": "综合评分",
    "verdictLevel": "判断等级",
    "verdict_level": "判断等级",
    "analysisResult": "分析结果",
    "analysis_result": "分析结果",
    "marketVerdict": "市场判断",
    "market_verdict": "市场判断",
    "selectionScore": "选品评分",
    "selection_score": "选品评分",
    "profitAnalysis": "利润分析",
    "profit_analysis": "利润分析",
    "consumerInsight": "消费者洞察",
    "consumer_insight": "消费者洞察",
    "strategicAction": "行动建议",
    "strategic_action": "行动建议",
    "concentrationAnalysis": "竞争集中度",
    "concentration_analysis": "竞争集中度",
    "aiVideoFeasibility": "AI 视频可行性",
    "ai_video_feasibility": "AI 视频可行性",
    "patentRisk": "专利风险",
    "patent_risk": "专利风险",
    "redditVocObservation": "用户声音补充",
    "reddit_voc_observation": "用户声音补充",
    "output_urls": "结果链接",
    "outputUrls": "结果链接",
    "summary": "摘要",
    "conclusion": "结论",
    "recommendation": "建议",
    "recommendations": "建议",
    "outlook": "市场展望",
    "keyDriver": "增长驱动",
    "key_driver": "增长驱动",
    "marketPhase": "市场阶段",
    "market_phase": "市场阶段",
    "opportunityScore": "机会评分",
    "opportunity_score": "机会评分",
    "score": "评分",
    "scoreTotal": "总分",
    "score_total": "总分",
    "scoreTier": "评级",
    "score_tier": "评级",
    "tierLabel": "评级说明",
    "tier_label": "评级说明",
    "confidence": "可信度",
    "evidence": "依据",
    "evidenceLevel": "依据完整度",
    "evidence_level": "依据完整度",
    "evidenceConfidence": "依据可信度",
    "evidence_confidence": "依据可信度",
    "riskLevel": "风险等级",
    "risk_level": "风险等级",
    "flaws": "主要风险",
    "strengths": "可用优势",
    "execution": "执行建议",
    "contentHook": "内容钩子",
    "content_hook": "内容钩子",
    "designFocus": "设计重点",
    "design_focus": "设计重点",
    "productAngle": "产品切入点",
    "product_angle": "产品切入点",
    "trafficTactics": "流量打法",
    "traffic_tactics": "流量打法",
    "coreDesire": "核心需求",
    "core_desire": "核心需求",
    "painPointGap": "痛点机会",
    "pain_point_gap": "痛点机会",
    "targetPersona": "目标画像",
    "target_persona": "目标画像",
    "voiceOfCustomer": "用户原声",
    "voice_of_customer": "用户原声",
    "topCompetitors": "头部竞品",
    "top_competitors": "头部竞品",
    "marketStructure": "市场结构",
    "market_structure": "市场结构",
    "visualHomogeneity": "视觉同质化",
    "visual_homogeneity": "视觉同质化",
    "clicheTrap": "避坑提醒",
    "cliche_trap": "避坑提醒",
}


_REPORT_VALUE_LABELS = {
    "high": "较高",
    "medium": "中等",
    "low": "较低",
    "unknown": "未明确",
    "sufficient": "数据较充分",
    "insufficient": "数据有待考究",
    "partial": "部分数据可参考",
    "critical": "需重点关注",
    "fragmented": "分散",
    "high-growth": "高增长",
    "true": "是",
    "false": "否",
}


_REPORT_SKIP_KEYS = {
    "id",
    "job_id",
    "jobId",
    "result_id",
    "resultId",
    "status",
    "progress",
    "stage",
    "logs",
    "enabled",
    "hidden_fields",
    "hiddenFields",
    "metadata",
    "raw",
    "debug",
    "trace",
    "request",
    "response",
    "input",
    "params",
    "parameters",
    "userId",
    "user_id",
    "productId",
    "product_id",
    "creatorId",
    "creator_id",
    "creatorKey",
    "fileId",
    "file_id",
    "variantId",
    "variant_id",
    "creditTransactionId",
    "credit_transaction_id",
    "formattedDimensions",
    "formatted_dimensions",
}


_REPORT_PRIORITY_KEYS = {
    "product_report": [
        "name",
        "productName",
        "targetMarket",
        "targetAudience",
        "sellingPoints",
        "verdictScore",
        "verdictLevel",
        "analysisResult",
    ],
    "creator_analysis": ["productName", "targetMarket", "result"],
    "creator_rank": ["productName", "targetMarket", "result"],
    "competitor_analysis": ["productName", "region", "result"],
    "competitor_multi": ["productName", "region", "result"],
    "video_analysis": ["productName", "result"],
}


_REPORT_HIGHLIGHT_LABELS = {
    "finalverdict": "最终判断",
    "commonpatterns": "共性打法",
    "productkeyword": "产品关键词",
    "pitfallguide": "避坑提醒",
    "opportunitywindows": "机会窗口",
    "opportunitywindow": "机会窗口",
    "intelligencefindings": "情报发现",
    "crossproductsummary": "多竞品总结",
    "riskboundary": "风险边界",
    "priorityangle": "优先切入角度",
    "executionorder": "执行顺序",
    "battlefieldsummary": "竞争格局",
    "singlecompetitor6p": "单竞品概览",
    "listingrecommendation": "上架建议",
    "marketverdict": "市场判断",
    "selectionscore": "选品判断",
    "strategicaction": "行动建议",
    "consumerinsight": "消费者洞察",
    "profitanalysis": "利润分析",
}


_REPORT_IDENTITY_KEYS = (
    "name",
    "productName",
    "product_name",
    "productUrl",
    "product_url",
    "region",
    "targetMarket",
    "target_market",
    "targetAudience",
    "target_audience",
    "verdictScore",
    "verdict_score",
    "verdictLevel",
    "verdict_level",
)


_TOP_PRODUCT_LABELS = {
    "productName": "商品",
    "product_name": "商品",
    "shopName": "店铺",
    "shop_name": "店铺",
    "price": "价格",
    "rating": "评分",
    "soldCount": "销量",
    "sold_count": "销量",
    "videoCount": "视频",
    "video_count": "视频",
    "creatorCount": "达人",
    "creator_count": "达人",
    "commissionRate": "佣金",
    "commission_rate": "佣金",
}


def _report_label(key: str) -> str:
    if key in _REPORT_SECTION_LABELS:
        return _REPORT_SECTION_LABELS[key]
    text = re.sub(r"[_-]+", " ", key)
    text = re.sub(r"(?<!^)([A-Z])", r" \1", text).strip()
    return text[:1].upper() + text[1:] if text else key


def _looks_like_noise_key(key: str) -> bool:
    if key in _REPORT_SKIP_KEYS:
        return True
    return bool(re.search(r"(?:^|_)(?:id|debug|raw|trace|request|response|metadata)(?:$|_)", key, re.I))


def _report_key_id(key: str) -> str:
    return re.sub(r"[^0-9a-z]+", "", key.lower())


def _short_report_text(value: Any, *, max_chars: int = 260) -> str:
    text = _report_scalar(value)
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_chars:
        return text[: max_chars - 1].rstrip("，,；;。 ") + "..."
    return text


def _repair_mojibake_text(text: str) -> str:
    """Best-effort cleanup for text that was decoded with the wrong CJK codec."""
    if not text:
        return ""
    candidates = [text]
    for encoding in ("gb18030", "gbk", "cp936"):
        try:
            repaired = text.encode(encoding, errors="ignore").decode("utf-8", errors="ignore")
        except Exception:
            continue
        if repaired:
            candidates.append(repaired)

    def score(value: str) -> int:
        penalty_chars = sum(value.count(ch) for ch in ("�", "鑷", "姘", "妫", "诲", "暟", "€", "檛"))
        cjk = sum(1 for ch in value if "\u4e00" <= ch <= "\u9fff")
        ascii_letters = sum(1 for ch in value if ch.isascii() and ch.isalpha())
        return cjk * 3 + ascii_letters - penalty_chars * 8

    best = max(candidates, key=score)
    return best.replace("\ufffd", "").strip()


def _clean_report_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    text = str(value).strip()
    if not text:
        return ""
    text = _repair_mojibake_text(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _clean_report_markdown(markdown: str) -> str:
    text = _clean_report_text(markdown)
    if not text:
        return ""
    text = re.sub(r"```json[\s\S]*?```", "", text, flags=re.I)
    text = re.sub(r"(?im)^\s*[-*]\s*(?:job_id|result_id|status|userId|user_id|product_id|creator_id|output_urls)\s*:.*$", "", text)
    text = re.sub(r"(?im)^\s*#{1,6}\s*(?:摘要|DeepSeen\s+.*?结果|DeepSeen\s+.*?报告)\s*$\n?", "", text).strip()
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def _report_scalar(value: Any) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{value:,}" if isinstance(value, int) else f"{value:,.2f}".rstrip("0").rstrip(".")
    text = _clean_report_text(value)
    return _REPORT_VALUE_LABELS.get(text.lower(), text)


def _render_report_value(value: Any, *, depth: int = 0, max_items: int = 8) -> list[str]:
    if depth > 4:
        scalar = _report_scalar(value)
        return [scalar] if scalar else []
    if isinstance(value, dict):
        lines: list[str] = []
        for key, item in value.items():
            if _looks_like_noise_key(str(key)):
                continue
            rendered = _render_report_value(item, depth=depth + 1, max_items=max_items)
            if not rendered:
                continue
            label = _report_label(str(key))
            if len(rendered) == 1 and not rendered[0].startswith(("-", "1.")):
                lines.append(f"- {label}: {rendered[0]}")
            else:
                lines.append(f"- {label}:")
                lines.extend(f"  {line}" for line in rendered[:max_items])
        return lines
    if isinstance(value, list):
        lines = []
        for index, item in enumerate(value[:max_items], 1):
            rendered = _render_report_value(item, depth=depth + 1, max_items=max_items)
            if not rendered:
                continue
            if len(rendered) == 1 and not rendered[0].startswith("-"):
                lines.append(f"{index}. {rendered[0]}")
            else:
                lines.append(f"{index}.")
                lines.extend(f"   {line}" for line in rendered[:max_items])
        return lines
    scalar = _report_scalar(value)
    return [scalar] if scalar else []


def _find_first_report_key(value: Any, wanted: set[str], *, depth: int = 0) -> Any:
    if depth > 6:
        return None
    if isinstance(value, dict):
        for key, item in value.items():
            if _report_key_id(str(key)) in wanted:
                return item
        for key, item in value.items():
            if _looks_like_noise_key(str(key)):
                continue
            found = _find_first_report_key(item, wanted, depth=depth + 1)
            if found is not None:
                return found
    if isinstance(value, list):
        for item in value[:8]:
            found = _find_first_report_key(item, wanted, depth=depth + 1)
            if found is not None:
                return found
    return None


def _iter_report_highlights(value: Any, *, depth: int = 0) -> list[tuple[str, Any]]:
    if depth > 5:
        return []
    items: list[tuple[str, Any]] = []
    if isinstance(value, dict):
        for key, item in value.items():
            key_text = str(key)
            if _looks_like_noise_key(key_text):
                continue
            normalized = _report_key_id(key_text)
            if normalized in _REPORT_HIGHLIGHT_LABELS:
                items.append((_REPORT_HIGHLIGHT_LABELS[normalized], item))
                continue
            items.extend(_iter_report_highlights(item, depth=depth + 1))
    elif isinstance(value, list):
        for item in value[:8]:
            items.extend(_iter_report_highlights(item, depth=depth + 1))
    return items


def _render_highlight_item(label: str, value: Any, *, max_lines: int = 4) -> list[str]:
    if isinstance(value, dict):
        lines: list[str] = []
        for key, item in value.items():
            normalized = _report_key_id(str(key))
            if _looks_like_noise_key(str(key)) or normalized in {"evidence", "evidencelevel", "source", "usage"}:
                continue
            text = _short_report_text(item, max_chars=220)
            if text:
                lines.append(f"- {_report_label(str(key))}: {text}")
            if len(lines) >= max_lines:
                break
        return [f"- {label}:"] + [f"  {line}" for line in lines] if lines else []
    if isinstance(value, list):
        rendered = []
        for item in value[:max_lines]:
            text = _short_report_text(item, max_chars=220)
            if text:
                rendered.append(f"- {label}: {text}")
        return rendered
    text = _short_report_text(value, max_chars=320)
    return [f"- {label}: {text}"] if text else []


def _report_identity_lines(data: Any) -> list[str]:
    if not isinstance(data, dict):
        return []
    lines: list[str] = []
    used_values: set[str] = set()
    for key in _REPORT_IDENTITY_KEYS:
        if key not in data or _looks_like_noise_key(key):
            continue
        text = _short_report_text(data.get(key), max_chars=160)
        if not text or text in used_values:
            continue
        used_values.add(text)
        lines.append(f"- {_report_label(key)}: {text}")
    return lines[:8]


def _report_top_products(data: Any, *, limit: int = 5) -> list[str]:
    products = _find_first_report_key(data, {"topproducts", "products", "competitors"})
    if not isinstance(products, list):
        return []
    lines = ["| 排名 | 商品 | 店铺 | 关键数据 |", "| --- | --- | --- | --- |"]
    count = 0
    for item in products:
        if not isinstance(item, dict):
            continue
        count += 1
        name = _short_report_text(
            item.get("productName") or item.get("product_name") or item.get("name") or "未命名商品",
            max_chars=52,
        )
        shop = _short_report_text(item.get("shopName") or item.get("shop_name") or item.get("brand") or "-", max_chars=28)
        metrics: list[str] = []
        for key in ("price", "rating", "soldCount", "sold_count", "videoCount", "video_count", "creatorCount", "creator_count"):
            if key in item:
                text = _short_report_text(item.get(key), max_chars=42)
                if text:
                    metrics.append(f"{_TOP_PRODUCT_LABELS.get(key, _report_label(key))} {text}")
            if len(metrics) >= 4:
                break
        lines.append(f"| {count} | {name} | {shop} | {'；'.join(metrics) or '-'} |")
        if count >= limit:
            break
    return lines if count else []


def _report_highlight_lines(data: Any, *, limit: int = 8) -> list[str]:
    lines: list[str] = []
    seen: set[str] = set()
    for label, value in _iter_report_highlights(data):
        rendered = _render_highlight_item(label, value)
        for line in rendered:
            marker = re.sub(r"\s+", " ", line).strip()
            if not marker or marker in seen:
                continue
            seen.add(marker)
            lines.append(line)
            if len(lines) >= limit:
                return lines
    return lines


def _fallback_markdown_findings(markdown: str, *, limit: int = 5) -> list[str]:
    text = _clean_report_markdown(markdown)
    if not text:
        return []
    findings: list[str] = []
    seen: set[str] = set()
    keywords = ("结论", "判断", "建议", "机会", "风险", "切入", "执行", "总结", "不建议", "建议")
    for raw_line in text.splitlines():
        line = re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", raw_line).strip()
        line = re.sub(r"^#{1,6}\s*", "", line).strip()
        if not line or len(line) < 8:
            continue
        if any(skip in line for skip in ("http://", "https://", "商品链接", "数据来源链接", "状态码")):
            continue
        if not any(word in line for word in keywords):
            continue
        line = _short_report_text(line, max_chars=220)
        if line and line not in seen:
            seen.add(line)
            findings.append(f"- {line}")
        if len(findings) >= limit:
            break
    return findings


def _report_key_findings(action: str, markdown: str, payload: dict[str, Any], *, limit: int = 5) -> list[str]:
    data = _extract_report_payload(payload)
    findings: list[str] = []
    seen: set[str] = set()
    for line in _report_highlight_lines(data, limit=limit + 3):
        if not line.startswith("- "):
            continue
        compact = re.sub(r"\s+", " ", line).strip()
        if compact in seen:
            continue
        seen.add(compact)
        findings.append(compact)
        if len(findings) >= limit:
            break
    if len(findings) < 2:
        for line in _fallback_markdown_findings(markdown, limit=limit):
            compact = re.sub(r"\s+", " ", line).strip()
            if compact not in seen:
                seen.add(compact)
                findings.append(compact)
            if len(findings) >= limit:
                break
    if not findings:
        action_label = _ACTION_LABELS.get(action, action)
        findings.append(f"- {action_label}已完成，详细结果见附件。")
    return findings[:limit]


def _extract_report_payload(payload: dict[str, Any]) -> Any:
    visible = payload.get("user_visible_fields")
    if isinstance(visible, dict):
        result = visible.get("result")
        if isinstance(result, dict):
            return result
        return visible
    return {}


def _build_business_report(action: str, markdown: str, payload: dict[str, Any]) -> str:
    action_label = _ACTION_LABELS.get(action, action)
    data = _extract_report_payload(payload)
    lines = [
        f"# DeepSeen {action_label}报告",
        "",
        f"- 生成时间: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 报告类型: {action_label}",
        "",
    ]

    findings = _report_key_findings(action, markdown, payload, limit=6)
    if findings:
        lines.extend(["## 一、关键结论", "", *findings, ""])

    if isinstance(data, dict) and data:
        overview = _report_identity_lines(data)
        if overview:
            lines.extend(["## 二、核心信息", "", *overview, ""])

        top_products = _report_top_products(data, limit=5)
        if top_products:
            lines.extend(["## 三、代表性商品", "", *top_products, ""])

        highlights = _report_highlight_lines(data, limit=10)
        if highlights:
            lines.extend(["## 四、重点分析", "", *highlights, ""])

    output_urls = payload.get("output_urls")
    if isinstance(output_urls, list):
        urls = [_clean_report_text(url) for url in output_urls if _clean_report_text(url)]
        if urls:
            lines.extend(["## 五、结果链接", "", *[f"- {url}" for url in urls], ""])

    lines.extend([
        "## 六、说明",
        "",
        "- 本报告仅保留面向业务决策的关键结论和代表性数据。",
        "- 已过滤任务 ID、状态、内部字段、接口字段名和其他对用户无意义的技术信息。",
        "- 具体数据以 DeepSeen 工具返回结果为准。",
    ])
    return "\n".join(lines).strip() + "\n"


def _deepseen_report_dir() -> Path:
    root = get_hermes_home() / "deepseen-reports"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_report_part(value: str) -> str:
    text = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "-", value.strip())
    text = text.strip("-._")
    return text[:64] or "result"


def _write_deepseen_report(action: str, markdown: str, payload: dict[str, Any]) -> Path | None:
    try:
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        report_path = _deepseen_report_dir() / f"deepseen-{_safe_report_part(action)}-{timestamp}.md"
        report_path.write_text(_build_business_report(action, markdown, payload), encoding="utf-8")
        return report_path
    except Exception:
        return None


def _compact_deepseen_summary(action: str, markdown: str, payload: dict[str, Any]) -> str:
    action_label = _ACTION_LABELS.get(action, action)
    findings = _report_key_findings(action, markdown, payload, limit=4)
    return "\n".join([f"**DeepSeen {action_label}完成**", "", *findings, "", "> 详细分析已整理成附件，可在下方下载。"]).strip()


def _with_report_download(action: str, markdown: str, payload: dict[str, Any]) -> str:
    report_path = _write_deepseen_report(action, markdown, payload)
    summary = _compact_deepseen_summary(action, markdown, payload)
    if not report_path:
        return summary
    report_href = f"#media:{quote(str(report_path), safe='')}"
    return (
        f"{summary}\n\n"
        "### 附件下载\n"
        f"- [下载 DeepSeen 完整报告]({report_href})"
    ).strip()


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
