from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class GovernanceFinding:
    level: str
    code: str
    message: str


class SkillGovernanceError(ValueError):
    def __init__(self, findings: list[GovernanceFinding]):
        self.findings = findings
        message = "Skill governance scan failed: " + "; ".join(item.message for item in findings)
        super().__init__(message)


_SECRET_PATTERNS = [
    (re.compile(r"\b(api[_-]?key|secret|access[_-]?token|refresh[_-]?token|password)\b", re.I), "疑似包含密钥、令牌或密码字段"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"), "疑似包含模型或平台密钥"),
    (re.compile(r"(私钥|密钥|令牌|密码)"), "疑似包含中文敏感凭据描述"),
]

_INJECTION_PATTERNS = [
    (re.compile(r"ignore (all )?(previous|prior) instructions", re.I), "疑似包含忽略系统指令的提示注入"),
    (re.compile(r"(system prompt|developer message|hidden instructions)", re.I), "疑似尝试读取或覆盖系统提示"),
    (re.compile(r"(你现在是|从现在开始你是).{0,20}(系统|开发者|管理员)"), "疑似角色越权提示"),
]


def scan_skill_content(content: str) -> list[GovernanceFinding]:
    text = content or ""
    findings: list[GovernanceFinding] = []
    for pattern, message in [*_SECRET_PATTERNS, *_INJECTION_PATTERNS]:
        if pattern.search(text):
            findings.append(GovernanceFinding("high", "content_risk", message))
    return findings


def enforce_publishable(content: str) -> None:
    findings = scan_skill_content(content)
    high = [item for item in findings if item.level == "high"]
    if high:
        raise SkillGovernanceError(high)
