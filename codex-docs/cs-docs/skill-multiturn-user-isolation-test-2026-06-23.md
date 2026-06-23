# 用户多轮对话 Skill 总结双写与用户隔离测试

测试日期：2026-06-23  
测试对象：多轮对话后通过 `skill_manage` 沉淀的 Skill，本地/数据库双写，以及用户 A / 用户 B 隔离  
测试环境：Windows 本地仓库 `D:\Users\Administrator\Desktop\hermes-agent-main`，PostgreSQL 容器 `deepseen-hermes-postgres`，连接 `127.0.0.1:55432/hermes`

## 结论

本轮只列未完全实现和残余风险：

1. **未完全闭环：本地共享 `skills/` 目录没有用户级隔离过滤。**
   - 用户 A 通过 `skill_manage(create)` 生成的 Skill 会写到同一个 `HERMES_HOME/skills` 本地目录。
   - 在没有启用企业 runtime snapshot 的情况下，同一个 `HERMES_HOME` 下切换到用户 B 后，`skills_list()` 和 `build_skills_system_prompt()` 都能看到用户 A 的 Skill。
   - 这意味着如果某条会话链路没有正确创建/应用 runtime snapshot，用户 B 的提示词可能混入用户 A 的 Skill。

2. **主链路可通过 runtime snapshot 实现隔离，但依赖条件必须保证。**
   - `tui_gateway.session.create` 会尝试按 `user_id + organization_id + session_id` 创建企业 Skill runtime snapshot，并在会话执行期间用 `set_runtime_skills_dir(session.runtime_skills_dir)` 绑定运行时 Skill 目录。
   - 桌面端新建会话当前会从登录 JWT 中解析用户 ID 并传给 `session.create`。
   - 只要登录 token 有有效用户 ID、数据库可连、会话创建成功生成 snapshot，则用户 B 的 runtime snapshot 不会包含用户 A 的 Skill。
   - 但该隔离目前更像“会话 runtime 快照链路保证”，不是本地 `skills/` 存储层天然保证。

## 实测证据

本轮用临时 `HERMES_HOME` 和真实 Postgres 跑隔离脚本，创建用户 A 的专属 Skill：

- 组织：`codex-user-skill-org-1782186099934`
- 用户 A：`codex-user-a-1782186099934`
- 用户 B：`codex-user-b-1782186099934`
- Skill：`codex-user-a-private-1782186099934`
- 哨兵描述：`PRIVATE_A_SENTINEL_1782186099934`

## 已验证通过的部分

### 数据库和本地双写

用户 A 创建 Skill 后返回：

```json
{
  "success": true,
  "enterprise_db_sync": {
    "synced": true,
    "organization_id": "codex-user-skill-org-1782186099934",
    "skill_id": "ae1247e1-07ef-4559-b8f3-dc3f0fba584b",
    "status": "published",
    "published": true
  }
}
```

本地文件存在：

```text
C:\Users\ADMINI~1\AppData\Local\Temp\hermes-user-skill-isolation-6a2ougtf\skills\qa-user-a\codex-user-a-private-1782186099934\SKILL.md
C:\Users\ADMINI~1\AppData\Local\Temp\hermes-user-skill-isolation-6a2ougtf\skills\qa-user-a\codex-user-a-private-1782186099934\references\a.md
```

数据库记录存在，且可见性是用户 A 专属：

```json
{
  "name": "codex-user-a-private-1782186099934",
  "organization_id": "codex-user-skill-org-1782186099934",
  "status": "published",
  "created_by": "codex-user-a-1782186099934",
  "scope_type": "user",
  "scope_id": "codex-user-a-1782186099934",
  "access_level": "use"
}
```

支持文件也同步进数据库：

```json
[
  {
    "path": "references/a.md",
    "has_content_text": true
  }
]
```

### 启用 runtime snapshot 后，用户隔离通过

用户 A runtime snapshot：

```json
{
  "skill_count": 1,
  "skill_ids": ["ae1247e1-07ef-4559-b8f3-dc3f0fba584b"]
}
```

用户 B runtime snapshot：

```json
{
  "skill_count": 0,
  "skill_ids": []
}
```

用户 B 在应用自己的 runtime snapshot 后：

```json
{
  "skills_list_has_user_a_skill": false,
  "prompt_has_user_a_skill": false,
  "skill_count": 0
}
```

用户 A 在应用自己的 runtime snapshot 后：

```json
{
  "skills_list_has_user_a_skill": true,
  "prompt_has_user_a_skill": true,
  "skill_count": 1
}
```

## 未完全实现 / 需要技术确认修复的点

### SKILL-ISO-001：无 runtime snapshot 时，本地 Skill 会跨用户进入提示词

严重级别：高  
影响范围：多用户共享同一后端 `HERMES_HOME` 的场景；任何未正确创建/应用 enterprise runtime snapshot 的会话链路。  
当前状态：未完全实现。

复现结果：同一 `HERMES_HOME` 下，用户 A 创建 Skill 后，切换逻辑用户为 B，但不设置 `HERMES_RUNTIME_SKILLS_DIR` / runtime snapshot：

```json
{
  "skills_list_has_user_a_skill": true,
  "prompt_has_user_a_skill": true,
  "skill_count": 1
}
```

代码原因：

- `agent.prompt_builder.build_skills_system_prompt()` 直接从 `get_skills_dir()` 和 `get_all_skills_dirs()` 扫描本地 Skill。
- `tools.skills_tool.skills_list()` 同样从 `_active_skills_dir()` 扫描本地 Skill。
- 本地 `skills/` 目录没有按 `HERMES_WEB_USER_ID`、`HERMES_SESSION_USER_ID` 或数据库 visibility 做过滤。

风险：如果用户 B 的会话因为登录用户 ID 缺失、数据库不可用、snapshot 创建失败、恢复旧会话缺少 `runtime_skills_dir` 等原因走到普通本地扫描，则用户 B 可能把用户 A 的 Skill 加进系统提示词。

建议修复方向：

1. 本地自动沉淀的用户私有 Skill 不应写入共享 `HERMES_HOME/skills`，应写入用户隔离目录，或只从 DB runtime snapshot 物化目录进入提示词。
2. `build_skills_system_prompt()` / `skills_list()` 在多用户模式下应强制要求 runtime snapshot；缺失时不要回退扫描共享本地用户私有 Skill。
3. `session.create` 创建 snapshot 失败时应向前端暴露明确错误或降级状态，不能静默回退到共享本地 Skill prompt。
4. 恢复会话时要确认 `runtime_skills_dir` 被重新创建或重新绑定，否则历史会话也可能走共享本地扫描。

## 技术链路观察

- `tools.skill_manager_tool._sync_skill_to_enterprise_db()` 当前创建新 Skill 时会写入：

```python
visibility=[{"scope_type": "user", "scope_id": actor_user_id, "access_level": "use"}]
```

- `hermes_cli.enterprise_skills.runtime_adapter.create_runtime_snapshot()` 会调用 `service.available_skills(...)`，按用户可用范围物化 runtime skills 目录。
- `tui_gateway.server` 新建会话时会尝试创建 runtime snapshot，并把 `runtime_skills_dir` 存入 session；提交 prompt 时会 `set_runtime_skills_dir(session.get("runtime_skills_dir"))`。
- 桌面端 `apps/desktop/src/app/session/hooks/use-session-actions.ts` 新会话会从 `localStorage.herbound_auth_token` 解出用户 ID 并传给 `session.create`。

## 最终判定

- 数据库双写：通过。
- 本地文件写入：通过。
- DB 用户级 visibility：通过。
- runtime snapshot 隔离：通过。
- 共享本地目录兜底隔离：不通过，需要技术继续处理。
