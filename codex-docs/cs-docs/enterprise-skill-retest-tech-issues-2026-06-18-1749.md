# 企业 Skill 知识库复测报告（2026-06-18 17:49 版）

## 1. 复测结论

本轮开发改动后，企业 Skill 知识库已经从“页面不可用/关键链路缺失”推进到“核心页面可访问、基础状态流转和后端运行时测试可通过”的阶段。

但按 `codex-docs/cp-docs/enterprise-skill-knowledge-base-design.md` 的目标验收，仍有多项企业级能力没有完整闭环，尤其是多组织/团队隔离、团队管理、真实自动沉淀、完整运行使用事件、审核治理可视化与前端 E2E 可测性。

当前建议：可以继续作为内部 MVP 联调用，但不建议标记为企业 Skill 知识库完整交付。

## 2. 本轮已验证通过项

- 前端构建通过：`npm run build --workspace hermes-web-ui`
- 后端新增模块语法检查通过：
  - `hermes_cli/enterprise_skills/db.py`
  - `hermes_cli/enterprise_skills/service.py`
  - `hermes_cli/enterprise_skills/runtime_adapter.py`
  - `hermes_cli/enterprise_skills/routes.py`
- 后端运行时测试通过：`python -m pytest -o addopts='' tests/test_enterprise_skills_runtime.py -q`
- 测试结果：`3 passed in 1.06s`
- 浏览器访问 `http://127.0.0.1:8649/#/hermes/enterprise-skills` 成功。
- 浏览器访问 `http://127.0.0.1:8649/#/hermes/skill-review` 成功。
- 企业 Skill 列表页不再被默认凭据弹窗阻塞。
- 企业 Skill 列表页无 console error/warn。
- 企业 Skill 详情页无 console error/warn。
- 审核页无 console error/warn。
- 企业 Skill 页面已出现关键测试标识：
  - `enterprise-skill-page`
  - `enterprise-skill-row`
  - `enterprise-skill-create-submit`
  - `enterprise-proposal-create`
  - `enterprise-skill-submit-review`
  - `enterprise-skill-approve`
  - `enterprise-skill-publish`
  - `enterprise-skill-rollback`
- 页面能展示企业 Skill 统计、技能列表、详情、版本记录、权限范围、支持文件、使用记录、反馈、审计日志等主要区域。
- 审核页能展示 `技能审核`、`Skill 草稿审核`、`沉淀提案审核` 等主要区域。
- 后端已补充基础状态机约束：
  - 草稿/拒绝后可提交审核。
  - 只有待审核可通过/拒绝。
  - 只有已通过可发布。
  - 发布前会调用治理检查。
- 后端已补充基础敏感内容/注入风险扫描，命中高风险内容时会阻断审核通过或发布。
- `skills_tool.py` 已补充企业 Skill 使用事件记录入口，至少覆盖 `listed` 和 `viewed`。
- `tui_gateway/server.py` 已补充基于用户意图关键词的企业 Skill 提案自动创建逻辑。

## 3. 仍未完整实现/缺失功能

### P1-001 多组织/多租户隔离仍未闭环

现象：

- 企业 Skill 后端仍大量使用默认组织 `default`。
- 路由层角色判断仍固定查询 `organization_id = 'default'`。
- 可见性规则、支持文件等写入仍有 `organization_id="default"` 的硬编码路径。

影响：

- 无法验证不同企业/组织之间的 Skill、提案、审计、文件是否完全隔离。
- 不满足企业知识库“组织级资产”的设计目标。
- 后续一旦接入真实多企业账号，存在跨组织误读/误写风险。

给技术的建议：

- 所有 API 从登录态/请求上下文解析 `organization_id`，禁止业务层默认落到 `default`。
- 为企业 Skill 增加至少两组组织级集成测试：`org_a` 不能读取/修改 `org_b` 的 Skill、提案、文件和审计记录。
- 将路由层、service 层、runtime adapter 层的组织 ID 传递链路打通。

### P1-002 团队管理与团队授权没有形成产品闭环

现象：

- 数据层存在 `teams`、`user_team_memberships` 相关能力。
- 运行时查询中可以看到按团队可见性过滤的痕迹。
- 但未看到团队 CRUD、成员管理、团队授权管理的完整 API/UI。
- 页面上可以看到权限范围区域，但不能完成“创建团队、加成员、按团队授权、验证成员可见性”的闭环。

影响：

- 设计中的 `organization -> team -> member` 权限模型无法被管理员实际配置。
- 无法验收“只对某团队可见/可用”的企业 Skill。
- 团队级知识沉淀和权限隔离仍停留在底层结构阶段。

给技术的建议：

- 增加团队管理 API：创建团队、编辑团队、删除团队、添加成员、移除成员。
- 增加团队权限 UI：在 Skill 权限范围中选择团队并保存。
- 补充浏览器 E2E：团队 A 成员可见，团队 B 成员不可见。

### P1-003 Agent 自动沉淀仍是关键词触发，不是自主识别流程沉淀

现象：

- `tui_gateway/server.py` 中新增了 `_ENTERPRISE_PROPOSAL_INTENTS`。
- 当前逻辑依赖用户消息包含“沉淀”“保存为技能”“生成 skill”“记成技能”等意图关键词。
- 只有命中关键词后才调用 `_maybe_create_enterprise_skill_proposal(...)`。

影响：

- 这更像“用户主动要求保存为 Skill”，不是设计文档要求的“从重复流程、复杂操作、稳定 SOP 中自动识别并沉淀提案”。
- 无法覆盖用户没有明确说“沉淀”的真实工作流。
- 缺少对多轮会话、工具调用轨迹、成功/失败结果、复用价值的自动判定。

给技术的建议：

- 将自动沉淀从关键词检测升级为“轨迹评估”：
  - 多轮会话是否包含稳定步骤。
  - 是否调用了工具并获得可复用结果。
  - 是否出现重复任务模式。
  - 是否有明确输入、输出、约束和适用场景。
- 对 `_maybe_create_enterprise_skill_proposal(...)` 增加单元测试和集成测试。
- 增加配置项控制自动沉淀策略：关闭、仅用户意图、低置信建议、高置信自动建草稿。

### P1-004 RBAC 仍缺团队级角色和跨角色测试覆盖

现象：

- 当前代码已引入 `org_admin`、`skill_admin`、`skill_reviewer` 等角色集合。
- 未看到 `team_admin` 角色在审核、授权、团队成员管理中的完整策略。
- 当前测试主要覆盖运行时和治理，未覆盖不同角色调用各 API 的允许/拒绝矩阵。
- 由于组织上下文仍硬编码 `default`，角色校验也无法证明多组织场景安全。

影响：

- 不能确认成员、团队管理员、审核员、组织管理员之间的边界是否符合设计。
- 容易出现普通成员越权发布、审核员越权改权限、团队管理员跨团队管理等问题。

给技术的建议：

- 建立 RBAC 权限矩阵测试：
  - `member`
  - `team_admin`
  - `skill_reviewer`
  - `skill_admin`
  - `org_admin`
- 每个角色至少覆盖：创建、编辑、提交审核、通过、拒绝、发布、归档、回滚、删除、改权限、改团队成员。
- API 返回应统一为 403，并带可读错误信息。

### P1-005 审核中心的安全治理结果展示仍不完整

现象：

- 后端已新增治理扫描，并在审核/发布时阻断高风险内容。
- 审核页当前可见的安全提示更像前端关键词判断，例如显示“未发现明显敏感字段”。
- 页面未展示后端扫描出的结构化风险项、风险等级、命中规则、处理建议。

影响：

- 审核员无法在 UI 中判断为什么某个 Skill 被阻断。
- 安全治理能力虽然在后端生效，但没有形成可解释审核体验。
- 审核流程中“可审计、可追溯、可说明”的企业要求仍不足。

给技术的建议：

- 后端返回治理扫描结果结构：
  - `severity`
  - `rule_id`
  - `message`
  - `field`
  - `suggestion`
- 审核页直接展示后端治理结果，不再只做前端关键词提示。
- 对被阻断的审核/发布操作，在 UI 中展示明确原因。

### P1-006 企业 Skill 使用事件仍缺实际执行链路事件

现象：

- 本轮已看到 `listed` 和 `viewed` 事件记录。
- 详情页 `使用记录` 对当前草稿仍显示 `暂无使用记录`，说明 UI 可显示但数据覆盖有限。
- 设计中的 `invoked`、`patched`、`failed` 等事件没有完整验收证据。
- 未看到从真实 Skill 调用/工具执行失败中稳定写入企业 Skill usage 的浏览器或后端集成测试。

影响：

- 企业管理员无法判断某个 Skill 是否真正被使用、失败率如何、是否需要优化。
- 无法支撑后续按使用数据做推荐、回滚、归档、治理优化。

给技术的建议：

- 在真实 Skill 执行入口记录：
  - `invoked`
  - `completed`
  - `failed`
  - `patched`
- 记录字段至少包含：skill_id、version_id、user_id、session_id、event_type、source、metadata、created_at。
- 增加测试：真实调用一个企业 Skill 后，详情页 `使用记录` 能看到对应事件。

### P2-001 审核页关键操作缺少稳定测试标识

现象：

- 审核页目前能找到 `enterprise-review-page`。
- 审核页的通过、拒绝、转为 Skill、审核意见输入等关键元素未发现稳定 `data-testid`。

影响：

- 自动化测试只能依赖按钮文案，容易受中文文案、状态、排序影响。
- 后续回归测试不稳定。

给技术的建议：

- 增加测试标识：
  - `enterprise-review-skill-approve`
  - `enterprise-review-skill-reject`
  - `enterprise-review-proposal-approve`
  - `enterprise-review-proposal-reject`
  - `enterprise-review-proposal-convert`
  - `enterprise-review-comment-input`

### P2-002 审核页仍展示非待审提案，状态语义容易混淆

现象：

- 审核页统计显示 `0待审提案`。
- 页面列表中仍显示一个 `已通过` 的提案 `Codex Gap Proposal`。
- 该提案区域仍能看到 `通过`、`拒绝`、`转为 Skill` 等操作按钮文案。

影响：

- 审核员可能误以为已通过提案仍在待处理列表中。
- “待审列表”和“历史列表”没有清晰分离。

给技术的建议：

- 待审区只展示 `pending_review` 项。
- 已通过/已拒绝项移动到历史区。
- 对不可操作按钮隐藏或展示明确禁用态与原因。

### P2-003 缺少完整前端 E2E 回归测试

现象：

- 当前已有后端运行时测试 `tests/test_enterprise_skills_runtime.py`。
- 未看到覆盖企业 Skill 页面、详情页、审核页的浏览器 E2E 测试。
- 当前前端验证仍主要依赖人工浏览器点击和 DOM 检查。

影响：

- 后续修改容易再次引入页面阻塞、按钮不可用、路由失效、状态展示错误等问题。
- 企业 Skill 模块是新功能，缺少 E2E 会增加回归风险。

给技术的建议：

- 增加 Playwright 或项目现有前端 E2E：
  - 进入企业 Skill 列表。
  - 创建草稿。
  - 提交审核。
  - 审核通过。
  - 发布。
  - 回滚。
  - 创建提案。
  - 提案转 Skill。
  - 验证审核页待审/历史状态。
  - 验证无权限用户不能执行管理操作。

## 4. 相比上一版已修复/改善的点

- 默认凭据弹窗不再阻塞企业 Skill 页面。
- 企业 Skill 主页面新增了较完整的 `data-testid`。
- 页面路由已经可达，不再是空白或不可操作状态。
- 后端新增企业 Skill 运行时/治理测试，且本轮通过。
- 状态机从“按钮存在”推进到“后端限制非法状态流转”。
- 审核拒绝接口已补充。
- 发布/审核前已有基础安全治理阻断。
- `skills_tool.py` 已开始记录企业 Skill 使用事件。
- TUI gateway 已补充基于用户意图的提案创建入口。

## 5. 本轮测试命令与结果

```powershell
npm run build --workspace hermes-web-ui
```

结果：通过。

```powershell
python -m py_compile hermes_cli/enterprise_skills/db.py hermes_cli/enterprise_skills/service.py hermes_cli/enterprise_skills/runtime_adapter.py hermes_cli/enterprise_skills/routes.py
```

结果：通过。

```powershell
python -m pytest -o addopts='' tests/test_enterprise_skills_runtime.py -q
```

结果：`3 passed in 1.06s`。

## 6. 浏览器复测记录

测试地址：

- `http://127.0.0.1:8649/#/hermes/enterprise-skills`
- `http://127.0.0.1:8649/#/hermes/skill-review`

企业 Skill 列表页验证：

- 页面标题：`企业 Skill 知识库`
- 可见区域：技能列表、新建企业 Skill、手动沉淀提案。
- 可见统计：总技能、已发布、待审提案、当前可用、预览快照。
- 可见按钮：刷新、筛选、保存技能、创建提案。
- 控制台：无 error/warn。

企业 Skill 详情页验证：

- 可见区域：版本记录、权限范围、支持文件、使用记录、反馈、审计日志。
- 可见按钮：保存草稿、提交审核、审核通过、发布、归档、回滚、删除、添加、保存支持文件、提交。
- 控制台：无 error/warn。

审核页验证：

- 页面标题：`技能审核`
- 可见区域：Skill 草稿审核、沉淀提案审核。
- 可见按钮：刷新、通过、拒绝、转为 Skill。
- 控制台：无 error/warn。

## 7. 给技术的优先级建议

优先补齐顺序：

1. 打通组织上下文，移除 `default` 组织硬编码。
2. 补齐团队管理和团队授权闭环。
3. 补齐 RBAC 权限矩阵测试。
4. 将自动沉淀从关键词触发升级为轨迹/复用价值判断。
5. 将后端治理扫描结果展示到审核页。
6. 补齐真实执行链路 usage 事件。
7. 补齐审核页 `data-testid` 与前端 E2E。

验收标准建议：

- 任意企业 Skill API 都必须带组织上下文并通过跨组织隔离测试。
- 任意管理操作都必须通过角色权限矩阵测试。
- 审核页必须能展示后端返回的治理风险。
- 真实执行一个企业 Skill 后，详情页必须能看到对应使用记录。
- 自动沉淀至少能在无明确“保存为 Skill”关键词时，基于会话轨迹生成待审提案。

