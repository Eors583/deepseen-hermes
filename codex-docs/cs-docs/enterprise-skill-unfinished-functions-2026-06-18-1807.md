# 企业 Skill 知识库未完成功能复测记录（2026-06-18 18:07 版）

## 1. 复测范围

本轮只记录开发修复后仍未完成或仍未形成产品闭环的功能。

已执行验证：

- `npm run build --workspace hermes-web-ui`：通过。
- `python -m py_compile hermes_cli\enterprise_skills\db.py hermes_cli\enterprise_skills\service.py hermes_cli\enterprise_skills\runtime_adapter.py hermes_cli\enterprise_skills\routes.py hermes_cli\enterprise_skills\governance.py`：通过。
- `python -m pytest -o addopts='' tests\test_enterprise_skills_runtime.py -q`：通过，`5 passed in 0.93s`。

本轮确认不再作为缺失项的问题：

- 后端已支持多组织隔离的基础 service 测试。
- 后端已支持团队可见性过滤的基础 service 测试。
- 后端已支持无明确“沉淀 Skill”关键词时，根据可复用流程轨迹生成提案的基础测试。
- 审核页已区分待审提案与历史提案。
- 审核页已展示后端治理扫描结果。
- 审核页关键操作已补充 `data-testid`。

## 2. 仍未完成功能

### P1-001 前端缺少组织切换能力，多组织仍无法在产品中实际使用

现象：

- 后端路由已支持从 `X-Enterprise-Organization-Id` 或 `organization_id` query 参数读取组织 ID。
- `hermes_cli/enterprise_skills/routes.py` 已新增 `/api/enterprise/organizations`。
- 但 `hermes-web-ui/packages/client/src/api/hermes/enterpriseSkills.ts` 中企业 Skill API 没有组织参数封装，也没有统一附带 `organization_id` 或组织请求头。
- `EnterpriseSkillsView.vue` 和 `SkillReviewView.vue` 中未看到组织选择器。
- 因此前端所有企业 Skill 页面请求仍会自然落到后端默认组织 `default`。

影响：

- 后端虽然具备多组织数据模型和部分隔离能力，但管理员在 Dashboard 中不能切换组织。
- 无法在产品界面中验证或使用多个企业/组织的 Skill 知识库。
- 企业多租户能力还没有形成端到端闭环。

建议：

- 在企业 Skill 页面和审核页增加组织选择器。
- 前端 API 层增加统一组织上下文传递。
- 所有企业 Skill 请求都应明确携带当前组织 ID。
- 增加前端/接口验收：切换 `org_a` 与 `org_b` 后，列表、提案、审核、使用记录互相隔离。

### P1-002 团队管理只有后端雏形，前端没有管理入口

现象：

- 后端已新增：
  - `GET /api/enterprise/teams`
  - `POST /api/enterprise/teams`
  - `GET /api/enterprise/teams/{team_id}/members`
  - `POST /api/enterprise/teams/{team_id}/members`
- 但 `enterpriseSkills.ts` 没有封装团队相关 API。
- `EnterpriseSkillsView.vue` 只允许在权限范围里手动输入 `scope_type=team` 和 `scope_id`。
- 前端没有团队列表、团队创建、成员添加、成员查看、团队选择器。

影响：

- 管理员无法在页面上创建团队、维护成员，也无法从下拉列表中选择团队授权。
- 普通使用者不知道团队 ID，团队授权只能靠手动输入 ID，实际不可用。
- “按团队沉淀和分发企业 Skill”的产品链路未完成。

建议：

- 增加团队管理页面或在企业 Skill 页面增加团队管理面板。
- 前端 API 增加 `fetchEnterpriseTeams`、`createEnterpriseTeam`、`fetchEnterpriseTeamMembers`、`addEnterpriseTeamMember`。
- 权限范围中 `scope_type=team` 时应展示团队选择器，而不是裸填 `scope_id`。

### P1-003 团队生命周期管理不完整，缺少编辑/删除/移除成员

现象：

- 当前后端只看到团队创建、列表、添加成员、查看成员。
- 未看到团队重命名、停用/删除团队、移除团队成员、修改成员角色等接口。

影响：

- 一旦团队成员变更或团队废弃，管理员无法完成维护。
- 权限规则可能长期引用已经不用的团队或错误成员。
- 企业级权限管理不能只增不删，否则上线后会留下治理风险。

建议：

- 增加团队更新接口。
- 增加团队停用/删除接口。
- 增加移除团队成员接口。
- 增加修改团队成员角色接口。
- 删除/停用团队时校验或提示受影响的 Skill 可见性规则。

### P1-004 使用记录字段前后端不匹配，页面无法正确展示事件类型

现象：

- 后端 `skill_usage_events` 表字段是 `event_type`。
- `service.record_usage_event(...)` 写入的也是 `event_type`。
- `tests/test_enterprise_skills_runtime.py` 断言的是 `event_type`，例如 `viewed`。
- 但前端类型 `EnterpriseSkillUsageEvent` 没有声明 `event_type`，只声明了 `status?: string | null`。
- `EnterpriseSkillsView.vue` 使用记录区域展示的是 `item.status || '记录'`。

影响：

- 即使后端记录了 `viewed`、`listed` 等事件，前端也不会显示具体事件类型。
- 用户在页面上看到的可能只是“记录”，无法判断这条记录是查看、调用、失败还是其他行为。
- 使用记录的可读性和审计价值不足。

建议：

- 前端 `EnterpriseSkillUsageEvent` 增加 `event_type`、`tool_name`、`metadata_json` 或解析后的 `metadata`。
- 使用记录区域展示 `event_type`，并映射中文文案。
- 保留 `status` 只用于真正的状态字段，不要混用事件类型。

### P1-005 真实执行链路的 usage 事件仍不完整

现象：

- 当前代码只明确看到：
  - `skills_list` 记录 `listed`
  - `skill_view` 记录 `viewed`
- 未看到真实 Skill 被 Agent 调用并完成任务时记录 `invoked`、`completed`、`failed`、`patched` 等事件。
- 当前测试也只断言了 `viewed`。

影响：

- 企业管理员无法统计某个 Skill 被实际调用了多少次、失败多少次、最近是否被 Agent 成功使用。
- 无法支撑后续的质量评估、下线决策、失败率监控和优化闭环。

建议：

- 在 Agent 真实加载并使用企业 Skill 的链路记录 `invoked`。
- 在模型完成后记录 `completed`。
- 在工具调用、权限、治理、加载异常时记录 `failed`。
- 如果运行时对 Skill 内容或上下文有补丁/回滚动作，记录 `patched`。
- 增加测试：一次真实 Agent 会话使用企业 Skill 后，详情页使用记录能显示事件类型和时间。

### P2-001 自动沉淀仍是启发式规则，缺少置信度和人工确认策略

现象：

- 当前自动沉淀已经从纯关键词升级为规则判断，可根据编号步骤、流程标记等识别可复用轨迹。
- 但仍是固定启发式规则：
  - 文本长度阈值。
  - 步骤数量。
  - 工作流关键词命中数。
- 未看到置信度评分、提案原因解释、用户确认策略或按组织配置不同策略的 UI。

影响：

- 可能漏掉没有明显编号但确实可复用的复杂流程。
- 也可能把格式化回答误判为可沉淀流程。
- 审核员难以判断自动提案为什么被创建。

建议：

- 提案记录中保存 `confidence`、`trigger_reason`、`detected_markers`。
- 审核页展示自动沉淀原因。
- 配置项增加产品 UI：关闭、仅用户明确要求、建议提案、自动建待审提案。

## 3. 给技术的处理顺序

建议按以下顺序继续补齐：

1. 先做组织选择和前端组织上下文传递。
2. 再做团队管理 UI 和团队 API 前端封装。
3. 补团队编辑/删除/移除成员等生命周期接口。
4. 修复 usage 前后端字段不匹配。
5. 补真实执行链路的 `invoked/completed/failed/patched` 使用事件。
6. 最后增强自动沉淀的置信度、解释和策略配置。

