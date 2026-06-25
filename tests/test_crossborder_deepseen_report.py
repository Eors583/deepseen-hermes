import importlib.util
from pathlib import Path


def _load_deepseen_plugin():
    path = Path(__file__).resolve().parents[1] / "plugins" / "crossborder-deepseen" / "__init__.py"
    spec = importlib.util.spec_from_file_location("crossborder_deepseen_plugin", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_deepseen_report_is_user_friendly_without_raw_json():
    plugin = _load_deepseen_plugin()
    payload = {
        "job_id": "job-123",
        "status": "completed",
        "output_urls": ["https://example.com/report"],
        "user_visible_fields": {
            "result": {
                "name": "自动卷发棒",
                "targetMarket": "US",
                "targetAudience": "职场女性",
                "sellingPoints": "防烫、防卡发",
                "verdictScore": 70,
                "analysisResult": {
                    "finalVerdict": "建议小批量测试，优先验证防烫和防卡发卖点。",
                    "opportunityWindows": "切入手残党和早八通勤场景。",
                    "riskBoundary": "温控与电机不能偷工减料。",
                    "patentRisk": {
                        "enabled": True,
                        "riskLevel": "unknown",
                        "confidence": "low",
                        "evidenceLevel": "insufficient",
                        "userId": "hidden-user-id",
                    },
                },
            },
        },
    }

    report = plugin._build_business_report("product_report", "## 摘要\n适合小批量测试。", payload)

    assert "# DeepSeen 选品分析报告" in report
    assert "产品名称: 自动卷发棒" in report
    assert "最终判断: 建议小批量测试" in report
    assert "```json" not in report
    assert "hidden-user-id" not in report
    assert "job-123" not in report
    assert "userId" not in report
    assert "依据完整度" not in report
    assert "insufficient" not in report


def test_deepseen_chat_summary_only_keeps_key_findings():
    plugin = _load_deepseen_plugin()
    payload = {
        "user_visible_fields": {
            "result": {
                "productName": "卷发棒 多竞品分析",
                "region": "US",
                "analysisResult": {
                    "topProducts": [
                        {
                            "productName": "Wavytalk Multi-Curl",
                            "shopName": "wavytalk",
                            "price": "$28.99 - 45.97",
                            "rating": 4.6,
                            "soldCount": 485939,
                            "productUrl": "https://example.com/hidden",
                        }
                    ],
                    "finalVerdict": "不建议硬刚传统单管卷发棒，应切入自动卷发器细分场景。",
                    "commonPatterns": "价格集中在 $25-$45，流量高度依赖 KOC 短视频。",
                    "riskBoundary": "温控和防卡发体验是差评高发点。",
                    "executionOrder": "先小批量测款，再铺底部 KOC 验证。",
                },
            }
        }
    }
    noisy_markdown = "\n".join([f"- 商品链接: https://example.com/{i}" for i in range(80)])

    summary = plugin._compact_deepseen_summary("competitor_multi", noisy_markdown, payload)

    assert "DeepSeen 多竞品分析完成" in summary
    assert "不建议硬刚传统单管卷发棒" in summary
    assert "详细分析已整理成附件" in summary
    assert "商品链接" not in summary
    assert "https://example.com" not in summary
    assert len(summary.splitlines()) <= 8
