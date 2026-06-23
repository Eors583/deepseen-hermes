# 企业 Skill 知识库本版复测技术问题单

测试时间：2026-06-18 17:26 +08:00  
测试环境：`http://127.0.0.1:8649`  
测试入口：

- `http://127.0.0.1:8649/#/hermes/enterprise-skills`
- `http://127.0.0.1:8649/#/hermes/skill-review`

依据文档：`codex-docs/cp-docs/enterprise-skill-knowledge-base-design.md`  
输出对象：技术开发  
输出口径：只列本版仍未完全实现、缺失、或需要技术继续处理的问题。

## 1. 本轮结论

本版相比上一轮有明显进展：

- 企业 Skill 页面已能在浏览器渲染。
- 技能审核页面已独立为 `/hermes/skill-review`。
- 企业 Skill 页面已有列表、新建、提案、详情、版本、回滚、权限、支持文件、反馈、审计等 UI。
- 前端构建通过。
- 企业 runtime 专项测试通过。

但仍不能按设计文档完整验收为“企业 Skill 知识库生产级闭环”。当前剩余问题主要集中在：

- 企业使用事件没有真正接入 agent 使用链路。
- 权限模型仍主要靠 `super_admin`，没有完整 RBAC 矩阵。
- 多组织、多团队、多租户管理没有产品闭环。
- 安全治理只是前端关键词提示，不是后端发布阻断。
- agent 自动沉淀 proposal 未接入 agent loop。
- UI 仍有可访问性和默认账户弹窗遮挡测试问题。

## 2. 本轮验证通过的基础项

以下内容本轮已验证通过，不作为缺失项：

| 验证项 | 结果 |
| --- | --- |
| 前端构建 | `npm run build --workspace hermes-web-ui` 通过 |
| 企业后端模块语法 | `python -m py_compile hermes_cli/enterprise_skills/*.py` 通过 |
| 企业 runtime 专项测试 | `python -m pytest -o addopts='' tests/test_enterprise_skills_runtime.py -q` 通过，`1 passed` |
| 企业技能页面渲染 | `/hermes/enterprise-skills` 已显示主体内容 |
| 技能审核页面渲染 | `/hermes/skill-review` 已显示独立审核中心 |
| 技能详情 UI | 点击技能后能看到版本记录、权限范围、支持文件、使用记录、反馈、审计日志 |
| runtime snapshot | 测试覆盖旧会话锁旧版本、新会话用新版本、`skills_list` 和 `skill_view` 可读取 |

## 3. P0 问题

### P0-001 企业 usage 事件没有接入 agent 实际使用链路

现象：

- 后端有 `skill_usage_events` 表。
- 后端有 `list_usage_events()` 和 `/api/enterprise/skills/usage`。
- 页面能展示“使用记录”。
- 但代码中没有发现 agent 调用 `skill_view`、`skills_list`、slash skill、或实际使用 enterprise skill 时写入 `skill_usage_events`。

证据：

- `hermes_cli/enterprise_skills/service.py` 只有查询 usage 的逻辑：`usage_count()`、`last_used_at()`、`list_usage_events()`。
- `tools/skills_tool.py` 的 `skill_view` 只调用本地 `tools.skill_usage.bump_use/bump_view`，未写企业表。
- `rg skill_usage_events` 未发现 insert 逻辑。

影响：

- 企业 Skill 页面“使用记录”“使用次数”“最近使用时间”不能反映真实 agent 使用情况。
- 设计文档要求的企业级使用统计、失败率、低效 skill 优化无法落地。

建议：

- 在 enterprise runtime materialized skill 中保留 skill_id / version_id 映射。
- 在 `skill_view` 成功读取 runtime skill 时写入 `skill_usage_events`，事件类型可为 `viewed` 或 `invoked`。
- 在 `skills_list` 列出 enterprise runtime skill 时写入 `listed`，可按 session 去重，避免刷屏。
- 在工具调用失败或 skill 执行失败场景记录 `failed`。
- 增加测试：`skill_view(enterprise_skill)` 后 `/usage` 返回对应事件。

### P0-002 agent 自动沉淀 proposal 未接入 agent loop

现象：

- 后端已有 `POST /api/enterprise/skills/proposals`。
- 前端已有“手动沉淀提案”。
- 审核中心能看到 proposal 并转换为 skill。
- 但没有发现 agent 完成复杂任务后自动判断、生成、提交 enterprise proposal 的链路。

证据：

- 搜索 `create_proposal` / `skill_proposals`，主要存在于 `hermes_cli/enterprise_skills/service.py` 和 routes。
- `agent` / `run_agent.py` / `tui_gateway` 没有实际调用 enterprise proposal 创建的业务链路。

影响：

- 设计文档里的“智能体自沉淀闭环”未完成。
- 当前只能人工创建 proposal，不符合 MVP 中“agent 生成的 skill 只能进入草稿审核池”的目标。

建议：

- 在 agent turn 完成后增加可配置的 proposal candidate 生成流程。
- 不要直接发布，只写入 enterprise proposal pending。
- 关联 `source_session_id`、任务摘要、工具调用摘要、建议分类、建议权限范围。
- 增加安全扫描后再进入审核池。

## 4. P1 问题

### P1-001 权限模型仍主要依赖 super_admin

现象：

- 设计文档要求角色矩阵：`super_admin`、`org_admin`、`skill_admin`、`skill_reviewer`、`team_admin`、`member`。
- 当前写操作路由大量使用 `require_super_admin(request)`。
- `org_admin` 只是通过 `ensure_default_membership` 写入 membership，但没有成为 API 授权判断。

证据：

- `hermes_cli/enterprise_skills/routes.py` 中创建、编辑、审核、发布、回滚、归档、权限、文件管理、proposal 审核等接口均使用 `require_super_admin`。
- `rg team_admin|skill_admin|skill_reviewer` 未发现实际权限分支。

影响：

- 组织管理员、技能管理员、审核员、团队管理员无法按设计文档分工。
- 普通成员和管理角色之间权限边界不可验收。

建议：

- 新增 enterprise RBAC helper，例如 `require_enterprise_role(request, allowed_roles, scope)`。
- 按设计矩阵拆分权限：
  - `skill_reviewer` 可审核，但不一定能配置权限。
  - `team_admin` 仅管理团队范围内 skill。
  - `member` 只能查看/使用有权限的 skill 和提交 proposal/feedback。
- 增加多角色 API 测试。

### P1-002 多组织 / 多租户管理仍未闭环

现象：

- 数据表有 `organizations` 和 `organization_id`。
- 当前实现大量默认使用 `organization_id="default"`。
- 前端没有组织管理、组织切换、组织成员管理。

证据：

- `hermes_cli/enterprise_skills/service.py` 多数方法默认 `organization_id: str = "default"`。
- `hermes_cli/enterprise_skills/db.py` seed 默认组织和默认 skill。
- 前端没有 organization selector 或组织管理页面。

影响：

- 不同企业之间互相不可见无法通过产品验收。
- 多租户隔离目前更多是数据结构预留，不是完整功能。

建议：

- 增加组织管理 API 和页面。
- 登录态携带当前 organization context。
- 所有 enterprise API 从 request/session 获取 organization，而不是硬编码 default。
- 增加跨组织隔离测试：A 组织 skill 不应在 B 组织 available/list/detail 中出现。

### P1-003 团队管理没有产品闭环

现象：

- 数据表有 `teams`、`user_team_memberships`。
- `available_skills()` 会读取 team membership。
- 但没有团队管理 API 和页面。

影响：

- 团队级 skill 可见性无法配置和验收。
- `team_admin` 角色无法落地。

建议：

- 增加 teams CRUD API。
- 增加团队成员管理 API。
- 前端增加团队/部门管理页面或在企业技能权限配置中可选择团队。
- 增加团队可见性 E2E 测试。

### P1-004 安全治理不是后端发布阻断

现象：

- 审核中心有 `securityText()`，会检查 `api_key`、`secret`、`token`、`password`、`私钥`、`密钥` 等关键词。
- 该检查在 `SkillReviewView.vue` 前端完成。
- 后端 create/update/approve/publish 没有统一安全扫描服务。

影响：

- 绕过前端直接调用 API 可以发布含敏感信息或 prompt injection 的 skill。
- 审核通过和发布没有强制安全门禁。

建议：

- 新增后端 `SkillGovernanceService`。
- 在 create draft、update draft、approve、publish、convert proposal 时执行扫描。
- 扫描项至少包括：
  - prompt injection：`ignore previous instructions`、`system prompt`、越权工具调用等。
  - secret/API key/token/password/私钥/密钥。
  - 支持文件路径、大小、类型。
  - scripts 发布限制。
- 将扫描结果持久化，并在审核中心展示。
- 高危结果应阻断 publish。

### P1-005 Skill 草稿审核缺少拒绝流程

现象：

- 审核中心的 “Skill 草稿审核” 区域只有“重新提交”和“审核通过”。
- 后端也没有发现 skill draft reject endpoint。

影响：

- 审核员不能拒绝不合格 skill draft。
- `skill_versions.status = rejected` 有数据状态，但流程没有完整入口。

建议：

- 增加 `POST /api/enterprise/skills/{skill_id}/reject`。
- 支持 review_comment。
- 前端 Skill 草稿审核区域增加“拒绝”。
- 被拒绝版本应回到可编辑 draft/rejected 状态，并保留审核意见。

### P1-006 发布流程允许绕过“提交审核”语义

现象：

- UI 详情区同时展示“提交审核”“审核通过”“发布”。
- 后端 `approve_version()` 和 `publish_version()` 没有强制校验状态必须为 `pending_review` / `approved`。
- 创建 skill 时 `publish: true` 会直接 approve + publish。

影响：

- 审核流更像按钮顺序建议，不是强制状态机。
- 不符合“agent/管理员必须经过审核发布”的治理要求。

建议：

- 后端强制状态机：
  - draft -> pending_review -> approved/rejected -> published
  - publish 只允许 approved version。
- 对 `publish: true` 做权限和治理限制，或只允许平台初始化 seed 使用。
- 增加非法状态流转测试。

## 5. P2 问题

### P2-001 默认账户安全弹窗会遮挡自动化/人工测试

现象：

- 企业技能页面加载后，默认账户安全弹窗仍会出现。
- 弹窗遮挡部分可点击区域。
- 需要按 `ESC` 才能继续完整测试。

影响：

- 自动化测试容易被弹窗干扰。
- 管理页面初次进入体验不顺。

建议：

- 为测试环境提供关闭默认账户弹窗的配置。
- 或弹窗使用非阻塞 banner。
- 或给弹窗按钮增加稳定 `data-testid` 并确保点击后关闭。

### P2-002 技能列表项不是标准可访问控件

现象：

- 技能列表项使用 `article.skill-row @click`。
- 可见 DOM 中没有暴露为 button/link。
- 自动化测试不能通过可访问角色直接点击，只能用 CSS `article.skill-row`。

影响：

- 可访问性不足。
- 自动化定位不稳定。

建议：

- 将列表项改为 `<button>` 或给 article 增加 `role="button"`、`tabindex="0"`、键盘事件。
- 增加 `data-testid="enterprise-skill-row"`。

### P2-003 企业 Skill UI 缺少稳定测试标识

现象：

- 页面控件主要依赖中文文本和 CSS 类定位。
- 缺少 `data-testid`。

影响：

- 后续 E2E 容易因文案调整失败。

建议：

- 给关键元素增加测试标识：
  - `enterprise-skill-page`
  - `enterprise-skill-row`
  - `enterprise-skill-create-submit`
  - `enterprise-skill-submit-review`
  - `enterprise-skill-approve`
  - `enterprise-skill-publish`
  - `enterprise-skill-rollback`
  - `enterprise-proposal-create`
  - `enterprise-review-page`

## 6. 建议补充测试清单

### 必补自动化测试

1. 企业 usage 事件测试：

```text
发布企业 skill
-> 创建 session runtime snapshot
-> set_runtime_skills_dir
-> skill_view(skill_name)
-> 查询 /api/enterprise/skills/usage 或 service.list_usage_events
-> 断言有 viewed/invoked 事件
```

2. RBAC 测试：

```text
member 只能 view/use/feedback/proposal
skill_reviewer 可以 approve/reject
skill_admin 可以 create/edit/publish/rollback
team_admin 只能操作团队范围
```

3. 多租户隔离测试：

```text
org A 发布 skill A
org B 发布 skill B
user A available/list/detail 不可见 skill B
user B available/list/detail 不可见 skill A
```

4. 后端安全阻断测试：

```text
draft content 包含 API key / ignore previous instructions
-> approve/publish 应失败或返回安全扫描风险
```

5. 审核状态机测试：

```text
draft 不能直接 publish
pending_review 可以 approve/reject
approved 可以 publish
rejected 不能 publish
```

6. 前端 E2E 测试：

```text
进入企业技能页
-> 新建 skill
-> 提交审核
-> 进入审核中心
-> 审核通过
-> 发布
-> 回到企业技能页确认 published
```

## 7. 本轮命令与浏览器验证记录

已执行：

```powershell
npm run build --workspace hermes-web-ui
python -m py_compile hermes_cli/enterprise_skills/db.py hermes_cli/enterprise_skills/service.py hermes_cli/enterprise_skills/runtime_adapter.py hermes_cli/enterprise_skills/routes.py
python -m pytest -o addopts='' tests/test_enterprise_skills_runtime.py -q
```

结果：

- 前端构建成功。
- Python 编译成功。
- 企业 runtime 测试通过：`1 passed in 0.62s`。

浏览器验证：

- `/hermes/enterprise-skills` 可显示企业 Skill 知识库主体内容。
- `/hermes/enterprise-skills` 点击技能后可显示详情区。
- `/hermes/skill-review` 可显示独立审核中心。
- 浏览器控制台未发现 error/warn。

## 8. 给技术的优先级建议

| 优先级 | 问题 | 建议处理 |
| --- | --- | --- |
| P0 | 企业 usage 事件未接入 agent 使用链路 | 先补写入事件和测试 |
| P0 | agent 自动沉淀 proposal 未接入 agent loop | 补 agent -> proposal pending 链路 |
| P1 | RBAC 仍是 super_admin 粗粒度 | 补 enterprise role helper 和权限矩阵测试 |
| P1 | 多组织/团队管理未闭环 | 补 org/team API、页面和隔离测试 |
| P1 | 安全治理只在前端提示 | 补后端治理服务和 publish 阻断 |
| P1 | 缺 Skill draft reject 和强制状态机 | 补 reject API、状态校验和测试 |
| P2 | 默认账户弹窗影响测试 | 提供测试环境关闭方式或稳定 testid |
| P2 | 列表项可访问性不足 | 改 button/role/button + testid |

