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
    assert "依据完整度: 数据有待考究" in report
    assert "```json" not in report
    assert "hidden-user-id" not in report
    assert "job-123" not in report
    assert "userId" not in report
    assert "insufficient" not in report
