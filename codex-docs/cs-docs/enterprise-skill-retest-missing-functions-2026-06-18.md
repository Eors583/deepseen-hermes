# 企业 Skill 知识库复测缺失项报告

测试时间：2026-06-18 17:03 +08:00  
测试对象：`http://127.0.0.1:8649/#/hermes/enterprise-skills`  
依据文档：`codex-docs/cp-docs/enterprise-skill-knowledge-base-design.md`  
测试范围：开发修复后的企业 Skill 知识库功能复测  
输出口径：只列出未完全实现的功能和缺失的功能

## 1. 本轮复测结论

开发修复后，后端企业 Skill API、runtime snapshot、`skills_list` / `skill_view` 读取企业 runtime skill 的链路已有明显进展。

但从产品验收角度看，企业 Skill 知识库仍不能按设计文档 MVP 完整验收。当前主要问题集中在：

- 当前运行中的前端页面仍没有展示企业 Skill 主体内容。
- 前端管理能力还没有覆盖完整生命周期。
- 审核中心、权限配置、支持文件、统计反馈、审计、安全治理、自动沉淀闭环仍不完整。
- 企业 Skill 专项自动化测试覆盖不足。

## 2. 本轮已确认的前置事实

以下内容不是缺失项，但用于说明复测依据：

| 项目 | 复测结果 |
| --- | --- |
| 后端企业 API 路由 | 已挂载，未登录命令行访问返回 `401 Unauthorized`，说明路由存在且受鉴权保护 |
| 前端构建 | `npm run build --workspace hermes-web-ui` 构建成功 |
| 企业 Skill 运行时目录 | `create_runtime_snapshot` 可生成 runtime skills 目录 |
| Agent skill 工具读取 | 通过 `set_runtime_skills_dir(...)` 后，`skills_list()` 能列出企业 skill，`skill_view()` 能读取内容 |
| session 级 runtime 绑定 | `tui_gateway/server.py` 已保存 `runtime_skills_dir`，并在 turn 运行时通过 `set_runtime_skills_dir` 绑定 |

## 3. P0 未完全实现 / 缺失

### P0-001 当前运行页面未渲染企业 Skill 主体内容

现象：

- 浏览器访问 `http://127.0.0.1:8649/#/hermes/enterprise-skills`。
- 页面 URL 正确，外层 Hermes Studio shell 正常。
- 页面只显示侧边栏、顶部状态、默认账户安全弹窗。
- 关闭/刷新后仍未看到企业 Skill 知识库主体内容，包括列表、新建表单、详情、审核提案等。

影响：

- 无法通过浏览器完成企业 Skill 页面功能验收。
- 管理员无法在当前运行服务中实际操作企业 Skill 管理后台。

判断：

- 前端源码和构建产物已有 `EnterpriseSkillsView`。
- 但当前 `8649` 服务实际展示仍没有业务主体，疑似运行服务未加载最新 dist、前端缓存/服务未重启、或页面挂载条件被阻塞。

### P0-002 浏览器 UI 全链路仍无法验证

由于企业 Skill 主体内容未渲染，本轮无法在页面内验证以下设计文档 MVP 操作：

- 管理员新建企业 skill。
- 编辑 draft。
- 提交审核。
- 审核通过。
- 发布。
- 普通员工查看可用 skill。
- 页面触发新会话后 runtime snapshot。
- 页面确认 `skill_view` 可读取新发布 skill。

### P0-003 缺少企业 Skill E2E 验收测试

当前没有看到覆盖以下完整链路的专项测试：

```text
创建企业 skill
-> 发布
-> 创建新会话
-> 生成 session runtime snapshot
-> skills_list 可见
-> skill_view 可读
-> 更新 skill 后新会话使用新版本
-> 老会话保持旧 snapshot
```

影响：

- 开发修复容易只修到局部，不能防止后续回归。
- 设计文档最关键的 MVP 闭环没有自动化保护。

## 4. P1 未完全实现 / 缺失

### P1-001 审核中心不是独立完整页面

现状：

- 路由 `/hermes/skill-review` 已存在。
- 但它复用 `EnterpriseSkillsView.vue`。

缺失：

- 独立待审核池。
- Skill draft 差异对比。
- agent 自动沉淀提案来源会话展示。
- 安全扫描结果展示。
- 审核意见输入。
- 审核通过/拒绝的独立流程视图。

### P1-002 前端缺少回滚功能入口

后端已有：

- `POST /api/enterprise/skills/{skill_id}/rollback`

前端缺失：

- `rollbackEnterpriseSkill` API wrapper。
- 版本选择 UI。
- “回滚到指定版本”操作按钮。
- 回滚前确认和回滚后状态展示。

### P1-003 前端缺少权限范围编辑 UI

后端已有：

- `GET /api/enterprise/skills/{skill_id}/visibility`
- `PUT /api/enterprise/skills/{skill_id}/visibility`

前端现状：

- 只展示 `visibility_rules`。

缺失：

- 新增权限规则。
- 编辑权限规则。
- 删除权限规则。
- 按 organization/team/user/role/profile 配置可见范围。
- access level 配置：`view/use/edit/approve/admin`。

### P1-004 前端缺少支持文件管理 UI

后端已有：

- `GET /api/enterprise/skills/{skill_id}/files`
- `POST /api/enterprise/skills/{skill_id}/files`
- `DELETE /api/enterprise/skills/files/{file_id}`

前端缺失：

- references 管理。
- templates 管理。
- scripts 管理。
- assets 管理。
- 文件内容编辑。
- 文件上传。
- 文件与版本绑定展示。

### P1-005 前端缺少 usage / feedback / audit 展示

后端已有：

- `GET /api/enterprise/skills/usage`
- `GET /api/enterprise/skills/feedback`
- `GET /api/enterprise/skills/audit`

前端缺失：

- Skill 使用次数趋势。
- 最近使用时间明细。
- 失败反馈列表。
- 用户评分/评论展示。
- 审计日志列表。
- 按 skill / user / session 过滤。

### P1-006 前端缺少 feedback 创建入口

后端已有：

- `POST /api/enterprise/skills/feedback`

前端缺失：

- 提交评分。
- 提交反馈文本。
- 从会话或技能详情页关联反馈。
- 反馈状态流转。

### P1-007 前端缺少 proposal 创建入口

前端现状：

- 可以列出 proposal。
- 可以审核、拒绝、转换 proposal。

缺失：

- 用户手动创建 proposal。
- 从会话结果发起“沉淀为企业 Skill 草稿”。
- proposal 创建后的来源会话、建议分类、建议范围确认 UI。

### P1-008 agent 自动沉淀闭环未完整实现

设计文档要求：

- agent 完成复杂任务后，可生成 skill proposal。
- proposal 进入审核池。
- 管理员审核后发布。

当前缺失：

- agent loop 自动判断沉淀时机。
- 自动生成 proposal 的入口。
- 与来源会话关联的 UI 展示。
- 安全扫描后再进入审核的流程。

## 5. P1 / P2 未完全实现 / 缺失

### P1/P2-001 权限矩阵仍偏粗

设计角色：

- `super_admin`
- `org_admin`
- `skill_admin`
- `skill_reviewer`
- `team_admin`
- `member`

当前问题：

- 写操作主要仍依赖 `require_super_admin`。
- `org_admin`、`skill_admin`、`skill_reviewer`、`team_admin` 没有按设计文档完整落地成操作权限矩阵。
- 缺少不同角色登录后的页面和 API 权限测试。

### P1/P2-002 多租户组织管理不完整

现状：

- 数据表包含 `organization_id`。
- 当前实现主要使用 `default` 组织。

缺失：

- 组织创建/编辑/禁用。
- 用户组织归属管理。
- 组织切换。
- 跨组织隔离 UI/API 验证。
- runtime snapshot 按组织隔离的完整端到端测试。

### P1/P2-003 team 管理闭环缺失

现状：

- 数据层存在 team 和 user_team_memberships 相关结构。
- available skill 计算中可考虑 team。

缺失：

- 团队创建、编辑、删除。
- 团队成员维护。
- team_admin 权限。
- 团队级 skill 可见范围配置页面。
- 团队级 skill 可用性验证。

### P1/P2-004 安全治理未完整实现

已看到：

- skill name 校验。
- support file path 校验。

缺失：

- prompt injection 扫描。
- API key / secret / token 敏感信息扫描。
- 用户隐私和业务敏感数据扫描。
- scripts 默认禁用或管理员发布限制。
- assets / 大文件 OSS 管理策略。
- 发布前安全扫描阻断。
- 安全扫描结果在审核中心展示。

### P1/P2-005 runtime API 仍保留进程级环境变量写入风险

现状进展：

- 已新增 `ContextVar` 级 `set_runtime_skills_dir`。
- `tui_gateway` turn 运行时会绑定 session runtime dir。

仍存在的问题：

- `hermes_cli/enterprise_skills/runtime_adapter.py` 的 `apply_runtime_env()` 仍会写入进程级 `HERMES_RUNTIME_SKILLS_DIR`。
- `/api/enterprise/skills/runtime-snapshot` 默认 `apply_to_process: true`。

风险：

- 如果该 API 被页面或其他调用方直接使用，可能影响同一进程内其他会话。
- 与设计文档要求的会话级 snapshot 隔离仍有冲突点。

建议：

- 默认不要写进程级 env。
- 页面预览 snapshot 只返回目录和 hash，不修改进程全局环境。
- 仅 agent turn 执行上下文通过 `ContextVar` 绑定 runtime skill dir。

## 6. 本轮建议修复顺序

| 优先级 | 修复项 |
| --- | --- |
| P0 | 修复当前运行服务企业 Skill 页面主体不渲染问题 |
| P0 | 增加企业 Skill E2E：创建 -> 发布 -> 新会话 -> skills_list -> skill_view |
| P0 | 确认当前 `8649` 服务加载最新 `hermes_cli/web_dist`，并处理缓存/重启问题 |
| P1 | 拆出独立审核中心 `/hermes/skill-review` |
| P1 | 补回滚、权限编辑、支持文件、usage、feedback、audit 前端功能 |
| P1 | 补 agent 自动沉淀 proposal 闭环 |
| P1/P2 | 完整落地 RBAC 权限矩阵和多租户组织/团队管理 |
| P1/P2 | 补安全治理服务和发布前阻断机制 |
| P1/P2 | 调整 runtime snapshot API，避免默认写入进程级 env |

## 7. 当前不能验收的设计文档 MVP 项

| MVP 项 | 当前状态 |
| --- | --- |
| 管理员可以新建并发布一个企业 skill | 后端和源码层有能力，但当前运行页面主体未渲染，浏览器不可验收 |
| 普通员工登录后能看到该 skill | 缺普通员工视角页面和角色验收 |
| 新建会话后该 skill 能被 agent 加载 | 运行时工具链局部验证通过，但缺正式 E2E |
| agent 能通过 `skill_view` 读取该 skill | 脚本级验证通过，缺从 UI 会话触发的端到端验证 |
| 同一企业不同员工共享 skill | 缺多用户/多角色验收 |
| 不同企业互相不可见 | 缺多组织管理和隔离验收 |
| 更新 skill 后新会话用新版本，老会话保持旧版本 | 缺自动化测试和 UI 验收 |
| agent 生成 skill 只能进入草稿审核池 | 只有 proposal 相关 API/UI雏形，agent 自动沉淀未闭环 |

## 8. 复测结论

当前版本相较上一轮已修复了部分后端和 runtime 接入问题，但企业 Skill 知识库仍不能按 MVP 完整验收。

最需要优先处理的是：

1. 当前运行页面主体不渲染。
2. 浏览器端企业 Skill 管理链路不可操作。
3. 缺少企业 Skill 端到端自动化测试。
4. 前端生命周期管理功能仍不完整。
5. 权限、组织团队、多租户、安全治理、自动沉淀仍未闭环。

