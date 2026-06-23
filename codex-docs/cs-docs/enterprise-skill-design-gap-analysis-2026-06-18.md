# 企业 Skill 知识库设计对照遗漏检查

依据文档：`codex-docs/cp-docs/enterprise-skill-knowledge-base-design.md`

检查日期：2026-06-18

检查对象：`hermes-agent-main` 当前工作区代码与 `http://127.0.0.1:8649/#/hermes/chat` 当前运行服务

## 1. 总体结论

当前项目已经有“企业 Skill 知识库”的基础原型，但尚未达到设计文档中的 MVP 验收标准。

已具备的部分：

| 模块 | 当前状态 |
| --- | --- |
| 数据库表 | 已有 organizations、teams、memberships、skill_definitions、skill_versions、skill_files、visibility、runtime_snapshots、usage_events、feedback、proposals、audit_logs |
| 后端服务类 | 已有创建、草稿更新、提交审核、审核通过、发布、回滚、归档、可用 skill 计算、proposal 创建、audit |
| 后端 API | 已定义 `/api/enterprise/skills` 相关接口 |
| runtime materialize | 已能按 snapshot 生成 runtime skill 目录 |
| TUI session 创建 | 有调用 `create_runtime_snapshot()` 并设置 `HERMES_RUNTIME_SKILLS_DIR` 的代码 |
| 前端路由源码 | 已新增 `/hermes/enterprise-skills` 路由 |
| 前端页面原型 | 已有列表、新建、发布的简版页面 |

未达成的关键点：

| 优先级 | 结论 |
| --- | --- |
| P0 | 当前运行中的 `8649` 服务没有加载企业技能前端路由和后端 API，浏览器访问仍失败 |
| P0 | 企业 runtime skill 目录没有真正接入 `skills_list` / `skill_view` / slash command 扫描 |
| P0 | 当前实现是进程级 `HERMES_RUNTIME_SKILLS_DIR`，不是会话级隔离，存在多会话串扰风险 |
| P0 | MVP 要求的“新建会话后企业 skill 被 agent 加载并可用 skill_view 读取”尚未闭环 |
| P1 | 前端页面只做了最小列表/新建/发布，缺详情、编辑、审核、版本、权限、统计、反馈、回滚、归档 |
| P1 | API 与设计文档不完全一致，归档方法、列表查询参数、available 返回内容都有缺口 |
| P1 | 权限模型过粗，仅 super_admin/member，未实现 org_admin、skill_admin、skill_reviewer、team_admin 等矩阵 |
| P1 | agent 自动沉淀 proposal 仅有 API，没有从 agent loop/tool/会话侧自动触发 |
| P1 | 安全扫描、prompt 注入检测、敏感信息过滤、支持文件限制没有完整治理服务 |

## 2. 代码定位

| 文件 | 关键点 |
| --- | --- |
| `hermes_cli/enterprise_skills/db.py:58` | 开始创建企业 skill 数据库表 |
| `hermes_cli/enterprise_skills/db.py:310` | seed 默认 `crossborder-deepseen` skill |
| `hermes_cli/enterprise_skills/service.py:80` | skill 列表 |
| `hermes_cli/enterprise_skills/service.py:110` | 创建 skill |
| `hermes_cli/enterprise_skills/service.py:171` | 更新草稿 |
| `hermes_cli/enterprise_skills/service.py:218` | 提交审核 |
| `hermes_cli/enterprise_skills/service.py:234` | 审核通过 |
| `hermes_cli/enterprise_skills/service.py:246` | 发布 |
| `hermes_cli/enterprise_skills/service.py:275` | 回滚 |
| `hermes_cli/enterprise_skills/service.py:295` | 归档 |
| `hermes_cli/enterprise_skills/service.py:325` | 可用 skill 计算 |
| `hermes_cli/enterprise_skills/service.py:373` | proposal 创建 |
| `hermes_cli/enterprise_skills/runtime_adapter.py:59` | 创建 runtime snapshot |
| `hermes_cli/enterprise_skills/routes.py:74` | 企业 skill API 开始 |
| `tui_gateway/server.py:3654` | TUI session 创建时生成 snapshot |
| `tools/skills_tool.py:615` | `skills_list` 仅扫描 `SKILLS_DIR` 和 external dirs |
| `tools/skills_tool.py:977` | `skill_view` 仅扫描 `SKILLS_DIR` 和 external dirs |
| `agent/skill_commands.py:279` | slash skill command 仅扫描 `SKILLS_DIR` 和 external dirs |
| `hermes-web-ui/packages/client/src/router/index.ts:81` | 前端新增企业技能路由 |
| `hermes-web-ui/packages/client/src/views/hermes/EnterpriseSkillsView.vue:39` | 前端加载企业 skill 列表 |
| `hermes-web-ui/packages/client/src/views/hermes/EnterpriseSkillsView.vue:55` | 前端新建企业 skill |
| `hermes-web-ui/packages/client/src/views/hermes/EnterpriseSkillsView.vue:81` | 前端发布企业 skill |

## 3. 设计项对照

### 3.1 数据模型

| 设计要求 | 当前状态 | 结论 |
| --- | --- | --- |
| organizations | 有 | 基本满足 |
| users 企业关系 | 有 `user_organization_memberships`，未复用/扩展 auth users 详情 | 部分满足 |
| teams | 有 | 基本满足 |
| user_team_memberships | 有 | 基本满足 |
| skill_definitions | 有 | 基本满足 |
| skill_versions | 有 | 基本满足 |
| skill_files | 有 | 基本满足 |
| skill_visibility_rules | 有 | 基本满足 |
| skill_runtime_snapshots | 有 | 基本满足 |
| skill_usage_events | 有表，无完整记录链路 | 部分满足 |
| skill_feedback | 有表，无 API/前端 | 部分满足 |
| skill_proposals | 有表和创建 API，无审核中心闭环 | 部分满足 |
| skill_audit_logs | 有表和基础写入，无查询/审计页面 | 部分满足 |

遗漏：

| 编号 | 遗漏 |
| --- | --- |
| GAP-DATA-001 | 没有 organization 管理 API/页面，当前固定 `default` organization |
| GAP-DATA-002 | 没有 team 管理 API/页面，team 表无法从前端维护 |
| GAP-DATA-003 | 没有用户企业/团队关系管理页面 |
| GAP-DATA-004 | usage_events、feedback、audit_logs 没有查询接口和前端展示 |
| GAP-DATA-005 | skill_files 表存在，但前端和 API 没有支持 references/templates/scripts/assets 上传与版本绑定 |

### 3.2 API

| 设计 API | 当前实现 | 结论 |
| --- | --- | --- |
| `GET /api/enterprise/skills` | 有，仅支持 `status` | 部分满足 |
| `GET /api/enterprise/skills/{skill_id}` | 有 | 基本满足 |
| `POST /api/enterprise/skills` | 有 | 基本满足 |
| `PUT /api/enterprise/skills/{skill_id}/draft` | 有 | 基本满足 |
| `POST /submit-review` | 有 | 基本满足 |
| `POST /approve` | 有 | 基本满足 |
| `POST /publish` | 有 | 基本满足 |
| `POST /rollback` | 有 | 基本满足 |
| `POST /archive` | 当前是 `DELETE /api/enterprise/skills/{skill_id}` | 不一致 |
| `GET /available` | 有，仅支持 `profile_id`，无 `session_id`，不返回 snapshot hash | 部分满足 |
| `POST /runtime-snapshot` | 有 | 基本满足 |
| `POST /proposals` | 有创建，无列表/审核/转换 | 部分满足 |

遗漏：

| 编号 | 遗漏 |
| --- | --- |
| GAP-API-001 | 列表缺 `scope`、`category`、`keyword`、`page`、`page_size` 等参数 |
| GAP-API-002 | 列表返回缺适用范围、最近使用时间、使用次数、负责人等设计字段 |
| GAP-API-003 | available 缺 `session_id` 参数，返回缺锁定版本号和 `snapshot_hash` |
| GAP-API-004 | 归档接口与设计不一致，设计是 `POST /archive`，当前是 `DELETE /skills/{id}` |
| GAP-API-005 | 缺 proposal 列表、详情、审核、拒绝、转换为 skill 的 API |
| GAP-API-006 | 缺 usage、feedback、audit 查询 API |
| GAP-API-007 | 缺 skill_files 上传/读取/删除 API |
| GAP-API-008 | 缺 visibility rules 增删改查 API |
| GAP-API-009 | 缺组织、团队、成员关系管理 API |

### 3.3 前端页面

| 设计页面/能力 | 当前状态 | 结论 |
| --- | --- | --- |
| `/hermes/enterprise-skills` | 源码有，当前运行服务未加载 | 未在运行环境生效 |
| Skill 列表 | 简版列表 | 部分满足 |
| 新建 Skill | 有简版表单 | 部分满足 |
| 查看详情 | 无 | 缺失 |
| 编辑草稿 | 无 | 缺失 |
| 提交审核 | 无 | 缺失 |
| 审核发布 | 只有直接发布按钮，无审核流页面 | 部分/缺失 |
| 版本记录 | 无 | 缺失 |
| 权限范围 | 无 | 缺失 |
| 使用统计 | 无 | 缺失 |
| 失败反馈 | 无 | 缺失 |
| 智能体推荐沉淀 | 无 | 缺失 |
| 审核中心 `/hermes/skill-review` | 无路由 | 缺失 |
| 员工技能页业务能力展示 | 当前 `/hermes/skills` 仍是底层 skill 列表/Hub 风格 | 未满足 |

遗漏：

| 编号 | 遗漏 |
| --- | --- |
| GAP-FE-001 | 当前运行服务没有企业技能路由，浏览器直达主区域空白 |
| GAP-FE-002 | 缺企业 Skill 详情页 |
| GAP-FE-003 | 缺草稿编辑、提交审核、审核意见、通过/拒绝流程 UI |
| GAP-FE-004 | 缺版本记录、diff、回滚入口 |
| GAP-FE-005 | 缺权限范围配置 UI |
| GAP-FE-006 | 缺使用统计、失败反馈、评分 UI |
| GAP-FE-007 | 缺 agent 自动沉淀 proposal 审核中心 |
| GAP-FE-008 | 普通员工技能页没有按“业务能力”重构展示 |
| GAP-FE-009 | 企业技能相关文案存在硬编码和乱码风险，尚未进入 i18n |

### 3.4 Hermes 兼容运行时

设计要求：

1. 会话创建时计算可用 skill。
2. 生成 `skill_runtime_snapshot`。
3. materialize 到 runtime 目录。
4. 当前会话的 Hermes skill scanner 指向该 snapshot。
5. `skills_list`、`skill_view`、slash command、prompt builder 继续工作。

当前实现：

| 项 | 当前状态 |
| --- | --- |
| 创建 snapshot | `tui_gateway/server.py:3654` 有调用 |
| materialize runtime dir | `runtime_adapter.py:59` 有实现 |
| 设置 runtime env | `runtime_adapter.py:149` 设置 `HERMES_RUNTIME_SKILLS_DIR` |
| `skills_list` 读取 runtime dir | 未看到实现 |
| `skill_view` 读取 runtime dir | 未看到实现 |
| slash command 扫描 runtime dir | 未看到实现 |
| prompt builder 使用 session snapshot | 未看到完整实现 |
| dashboard 当前运行服务验证 | 企业 API/前端路由仍 404/空白 |

遗漏：

| 编号 | 遗漏 |
| --- | --- |
| GAP-RUNTIME-001 | `tools/skills_tool.py` 只扫描 `SKILLS_DIR` 和 `skills.external_dirs`，没有读取 `HERMES_RUNTIME_SKILLS_DIR` |
| GAP-RUNTIME-002 | `agent/skill_commands.py` 只扫描 `SKILLS_DIR` 和 external dirs，企业 runtime skill 不会成为 slash command |
| GAP-RUNTIME-003 | `HERMES_RUNTIME_SKILLS_DIR` 是进程级环境变量，多会话/多用户会互相覆盖 |
| GAP-RUNTIME-004 | snapshot 创建只在 TUI session 创建处看到，普通 dashboard/chat/API agent 路径是否覆盖不完整 |
| GAP-RUNTIME-005 | 老会话保持旧 snapshot、新会话用新版本的 prompt cache 策略没有完整验证和测试 |
| GAP-RUNTIME-006 | 没有显式“刷新当前会话技能”功能 |

### 3.5 权限与治理

| 设计要求 | 当前状态 | 结论 |
| --- | --- | --- |
| super_admin / org_admin / skill_admin / skill_reviewer / team_admin / member | 当前主要依赖 super_admin，默认 membership 写 org_admin/member | 部分满足 |
| 权限矩阵 | 无完整矩阵实现 | 缺失 |
| 组织/团队/角色可见性 | service 支持 organization/team/user/role/profile 计算，但无管理闭环 | 部分满足 |
| agent 不能直接写 published | 本地 `skill_manage` 仍可写本地 skill；企业 proposal 机制未接入 agent | 未满足 |
| 安全扫描 | 本地 skill guard 有一套，企业发布流未见完整 SkillGovernanceService | 部分/缺失 |
| prompt 注入检测 | 企业发布流未见强制扫描 | 缺失 |
| 审计 | 基础 audit 写入有，查询/展示缺失 | 部分满足 |
| 多租户隔离 | 表有 organization_id，但运行时固定 default，API 未暴露组织上下文 | 部分满足 |

遗漏：

| 编号 | 遗漏 |
| --- | --- |
| GAP-GOV-001 | 缺 SkillGovernanceService |
| GAP-GOV-002 | 发布前没有强制 prompt 注入扫描 |
| GAP-GOV-003 | 没有敏感信息/API key/隐私数据扫描 |
| GAP-GOV-004 | 没有 scripts/assets 支持文件限制策略 |
| GAP-GOV-005 | 权限矩阵未按设计角色落地 |
| GAP-GOV-006 | 多租户仍固定 `default`，缺真实 organization 上下文 |
| GAP-GOV-007 | 本地 `skill_manage` 生产环境禁写/改走 proposal 的策略未落地 |

### 3.6 Agent 自动沉淀

| 设计要求 | 当前状态 | 结论 |
| --- | --- | --- |
| agent 判断可沉淀流程 | 未见接入 | 缺失 |
| agent 生成 proposal | 只有 API，未见 agent 调用路径 | 部分/缺失 |
| proposal 进入审核池 | 有表和创建 API，无列表/审核 UI | 部分满足 |
| 来源会话关联 | proposal 字段有 `source_session_id` | 部分满足 |
| 安全扫描后发布 | 未见完整流程 | 缺失 |

遗漏：

| 编号 | 遗漏 |
| --- | --- |
| GAP-AGENT-001 | agent loop 或工具层没有自动创建 enterprise proposal |
| GAP-AGENT-002 | 没有“本次流程可沉淀为企业技能”的用户确认交互 |
| GAP-AGENT-003 | 没有 proposal 审核中心 |
| GAP-AGENT-004 | 没有从 proposal 转为 skill draft/version 的服务方法和 API |

## 4. 运行环境验证结论

前一轮浏览器测试已经确认：

| 场景 | 结果 |
| --- | --- |
| 访问 `/hermes/enterprise-skills` | 主区域空白，Vue Router 提示 no match |
| 调用 `/api/enterprise/skills` | 当前 `8649` 服务返回 `404 Not Found` |
| 调用 `/api/enterprise/skills/available` | 当前 `8649` 服务返回 `404 Not Found` |
| 本地 Python 编译 enterprise modules | 通过 |
| 本地导入并初始化 enterprise DB | 通过，默认 seed 1 条 skill |

这说明“当前工作区代码”和“当前运行中的 8649 服务”不同步。即使代码里有企业技能模块，当前页面实际使用的服务还没加载它。

## 5. MVP 验收标准对照

设计文档 MVP 标准逐项检查：

| MVP 标准 | 当前状态 | 结论 |
| --- | --- | --- |
| 管理员可以新建并发布一个企业 skill | 源码层后端可支持，运行服务 404，前端只简版支持 | 未通过 |
| 普通员工登录后能看到该 skill | 后端 service 有 available 计算，前端/运行服务未闭环 | 未通过 |
| 新建会话后该 skill 能被智能体加载 | TUI 有 snapshot 创建，skills scanner 未读 runtime dir | 未通过 |
| 智能体能通过 `skill_view` 读取该 skill | `skill_view` 未接 runtime dir | 未通过 |
| 同一企业不同员工共享 skill | 数据模型支持，缺真实组织/员工管理闭环 | 未通过 |
| 不同企业之间互相不可见 | 表结构支持 organization_id，当前固定 default | 未通过 |
| 更新后新会话用新版本，老会话保持旧版本 | snapshot 表支持，进程级 env 和 scanner 缺口导致未闭环 | 未通过 |
| 智能体生成的 skill 只能进入草稿审核池 | 有 proposal 创建 API，无 agent 接入和审核中心 | 未通过 |

## 6. 建议优先级

### P0 必须先补

| 编号 | 建议 |
| --- | --- |
| FIX-P0-001 | 修复当前 `8649` 服务加载问题，确保前端路由和后端 enterprise router 在运行环境生效 |
| FIX-P0-002 | 让 `skills_list`、`skill_view`、`agent/skill_commands.py` 读取 session runtime skill dir |
| FIX-P0-003 | 避免进程级 `HERMES_RUNTIME_SKILLS_DIR` 串扰，改成 session/context 级技能目录传递 |
| FIX-P0-004 | 增加端到端测试：创建企业 skill -> 发布 -> 创建新会话 -> `skills_list` 可见 -> `skill_view` 可读 |

### P1 进入产品闭环

| 编号 | 建议 |
| --- | --- |
| FIX-P1-001 | 补企业 Skill 详情、编辑草稿、提交审核、审核通过/拒绝、发布、回滚、归档页面 |
| FIX-P1-002 | 补审核中心 `/hermes/skill-review` |
| FIX-P1-003 | 补 visibility rules 管理 API 和页面 |
| FIX-P1-004 | 补 proposal 列表、审核、转换为 draft skill |
| FIX-P1-005 | 补 usage、feedback、audit 查询 API 和页面 |
| FIX-P1-006 | 补列表分页、搜索、分类、scope 过滤 |
| FIX-P1-007 | 修正归档 API 与设计一致，或更新设计文档确认使用 DELETE |

### P2 治理与长期演进

| 编号 | 建议 |
| --- | --- |
| FIX-P2-001 | 落地 SkillGovernanceService，包括 prompt 注入、敏感信息、支持文件限制 |
| FIX-P2-002 | 设计真实 organization/team/member 管理后台 |
| FIX-P2-003 | 将 `/hermes/skills` 从底层 skill 文件列表逐步改为员工业务能力页 |
| FIX-P2-004 | 抽象 SkillProvider，为长期 DB provider 替代文件扫描做准备 |
| FIX-P2-005 | 统一企业化的 prompt/profile/tool policy/output schema 数据库调配 |

## 7. 最终判断

当前项目没有遗漏“方向”，但遗漏了大量“闭环”：

1. 后端表和 service 已经起步。
2. 前端只有最小原型。
3. 当前运行环境没有加载新增企业模块。
4. 最关键的 Hermes agent 兼容层没有真正接上 `skills_list` / `skill_view`。
5. 权限、审核、统计、反馈、自动沉淀、安全治理都还没有达到设计文档要求。

因此不能按“企业 Skill 知识库 MVP 已完成”验收，只能按“基础数据层和部分 API 原型已完成”验收。
