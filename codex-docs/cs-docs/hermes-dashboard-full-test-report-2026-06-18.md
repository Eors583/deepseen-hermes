# Hermes Dashboard 全方位测试报告

测试对象：`http://127.0.0.1:8649/#/`

测试日期：2026-06-18

测试角色：测试负责人

测试结论：当前主功能页面大部分可以访问，登录、基础导航、健康检查、Profiles、Skills 等接口可用；但“企业技能”相关前后端在当前运行服务中没有生效，属于高优先级阻塞问题。另有默认账号安全弹窗会覆盖所有登录后页面，需要在功能测试前处理或明确作为安全提示验收项。

## 1. 测试环境

| 项目 | 内容 |
| --- | --- |
| 前端地址 | `http://127.0.0.1:8649/#/` |
| Web UI 版本 | `0.6.14` |
| Hermes 健康检查 | `/health` 返回 `200` |
| 登录账号 | `admin / 123456` |
| 登录角色 | `super_admin` |
| 浏览器自动化 | Playwright Chromium |
| 桌面视口 | `1366 x 768` |
| 移动视口 | `390 x 844` |

## 2. 测试范围

本次覆盖以下方向：

| 类型 | 覆盖内容 |
| --- | --- |
| 认证 | 未登录访问、默认账号登录、管理员 token 注入、普通 admin 权限模拟 |
| 路由 | 登录页、聊天、历史、任务、看板、模型、日志、用量、技能、插件、记忆、设置、频道、终端、设备、文件、编程工具、用户、性能、版本预览、MCP、企业技能 |
| 接口 | `/health`、`/api/hermes/profiles`、`/api/hermes/skills`、`/api/enterprise/skills`、`/api/enterprise/skills/available` |
| 兼容性 | 桌面视口、移动视口 |
| 前端异常 | 控制台 warning/error、Vite overlay、网络请求失败 |
| 构建 | `npm run build` |

## 3. 测试产物

| 产物 | 路径 |
| --- | --- |
| 自动化路由审计 JSON | `codex-docs/cs-docs/playwright-route-audit.json` |
| 页面截图目录 | `codex-docs/cs-docs/screenshots/` |
| 可见浏览器测试 JSON | `codex-docs/cs-docs/browser-visible/visible-browser-audit.json` |
| 可见浏览器截图目录 | `codex-docs/cs-docs/browser-visible/` |
| 企业技能页面截图 | `codex-docs/cs-docs/screenshots/_hermes_enterprise_skills_super_1366.png` |
| 移动端聊天截图 | `codex-docs/cs-docs/screenshots/_hermes_chat_super_390.png` |

## 4. 通过项

| 编号 | 测试点 | 结果 |
| --- | --- | --- |
| PASS-001 | 未登录访问 `/` 展示登录页 | 通过 |
| PASS-002 | `admin / 123456` 可登录并获得 `super_admin` token | 通过 |
| PASS-003 | `/health` 返回 `200`，服务运行正常 | 通过 |
| PASS-004 | `/api/hermes/profiles` 返回 `200` | 通过 |
| PASS-005 | `/api/hermes/skills` 返回 `200` | 通过 |
| PASS-006 | 主要页面路由可加载，无 Vite error overlay | 通过 |
| PASS-007 | `npm run build` 构建成功 | 通过 |
| PASS-008 | 移动端聊天页面可加载，输入区可见 | 通过 |
| PASS-009 | 可见浏览器中登录、关闭默认账号弹窗、进入主要导航页 | 通过 |
| PASS-010 | 聊天输入框可输入文本且未发送时不会产生会话副作用 | 通过 |

已巡检的主要页面包括：

`/hermes/chat`、`/hermes/history`、`/hermes/jobs`、`/hermes/kanban`、`/hermes/models`、`/hermes/logs`、`/hermes/usage`、`/hermes/skills-usage`、`/hermes/skills`、`/hermes/plugins`、`/hermes/memory`、`/hermes/settings`、`/hermes/channels`、`/hermes/terminal`、`/hermes/devices`、`/hermes/files`、`/hermes/coding-agents`、`/hermes/profiles`、`/hermes/performance`、`/hermes/version-preview`、`/hermes/mcp`。

## 5. 缺陷列表

### BUG-001 企业技能前端路由在当前运行服务中未注册

严重级别：P0

影响范围：企业技能页面入口、超级管理员企业技能管理功能

现象：

访问 `http://127.0.0.1:8649/#/hermes/enterprise-skills` 时，控制台出现：

```text
[Vue Router warn]: No match found for location with path "/hermes/enterprise-skills"
```

页面没有进入企业技能功能页，截图中仍停留在默认账号安全提示弹窗覆盖状态，侧边栏也没有显示企业技能入口。

复现步骤：

1. 打开 `http://127.0.0.1:8649/#/`。
2. 使用 `admin / 123456` 登录。
3. 访问 `http://127.0.0.1:8649/#/hermes/enterprise-skills`。
4. 查看控制台和页面内容。

期望结果：

超级管理员应能进入企业技能知识库页面，并看到技能列表、新建 Skill 表单、刷新按钮等内容。

实际结果：

当前运行服务未匹配该路由。

证据：

| 证据 | 路径 |
| --- | --- |
| 自动化审计 | `codex-docs/cs-docs/playwright-route-audit.json` |
| 截图 | `codex-docs/cs-docs/screenshots/_hermes_enterprise_skills_super_1366.png` |

补充定位：

源码中存在企业技能路由：`hermes-web-ui/packages/client/src/router/index.ts:81`。

当前 `8649` 服务实际返回的 `/src/router/index.ts` 来自 `.tmp-hermes-web-ui`，其中不包含 `/hermes/enterprise-skills`。这说明当前运行服务和工作区源码不同步，或服务没有重启/没有加载最新前端源码。

建议：

1. 重启 `8649` 对应的前端/后端服务，确认运行目录是否指向当前工作区。
2. 检查 `.tmp-hermes-web-ui` 的生成逻辑，确保新增路由会同步进去。
3. 修复后复测 `/hermes/enterprise-skills` 路由和侧边栏入口。

可见浏览器补测：

直接访问 `/#/hermes/enterprise-skills` 后，主内容区域为空白，只保留侧边栏；控制台仍出现 Vue Router 未匹配警告。

证据：

| 证据 | 路径 |
| --- | --- |
| 可见浏览器截图 | `codex-docs/cs-docs/browser-visible/direct-enterprise-skills.png` |
| 可见浏览器审计 | `codex-docs/cs-docs/browser-visible/visible-browser-audit.json` |

### BUG-002 企业技能后端 API 在当前运行服务中返回 404

严重级别：P0

影响范围：企业技能列表、新建、发布、可用技能查询

接口抽测结果：

| 接口 | 结果 |
| --- | --- |
| `/api/enterprise/skills` | `404 Not Found` |
| `/api/enterprise/skills/available` | `404 Not Found` |
| `/api/hermes/skills` | `200 OK` |
| `/api/hermes/profiles` | `200 OK` |
| `/health` | `200 OK` |

复现命令：

```powershell
$token=(Invoke-RestMethod -Method Post http://127.0.0.1:8649/api/auth/login -ContentType 'application/json' -Body '{"username":"admin","password":"123456"}').token
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8649/api/enterprise/skills -Headers @{Authorization="Bearer $token"}
```

期望结果：

返回 `200`，响应结构为：

```json
{"skills":[]}
```

实际结果：

返回 `404 Not Found`。

补充定位：

源码中有路由挂载：`hermes_cli/web_server.py:12065` 和 `hermes_cli/web_server.py:12066`。

源码中有 API 定义：`hermes_cli/enterprise_skills/routes.py`。

当前运行中的 `8649` 服务没有加载这些后端路由，和 BUG-001 一样，疑似运行进程未使用当前工作区最新代码。

建议：

1. 重启 Python Web Server。
2. 确认启动命令使用的是当前仓库路径，而不是旧安装包或临时目录。
3. 修复后复测列表、新建、发布、available、权限拒绝这几类接口。

### BUG-003 默认账号安全弹窗覆盖所有登录后页面

严重级别：P1

影响范围：所有登录后页面的功能测试和用户初次使用体验

现象：

登录后页面会弹出“请修改默认账户和密码”弹窗，并遮罩页面主体。桌面和移动端均会出现。

期望结果：

作为安全提示可以保留，但测试或正常使用时应有明确的“稍后提醒”路径，且关闭后不应反复阻塞同一轮页面巡检。

实际结果：

自动化巡检截图多数被该弹窗覆盖，影响进一步点击和内容可见性验证。

证据：

| 证据 | 路径 |
| --- | --- |
| 桌面截图 | `codex-docs/cs-docs/screenshots/_hermes_enterprise_skills_super_1366.png` |
| 移动截图 | `codex-docs/cs-docs/screenshots/_hermes_chat_super_390.png` |

建议：

1. 正式测试前修改默认账号密码，或在测试脚本中先点击“稍后提醒”。
2. 若产品设计允许，增加测试环境关闭该提醒的配置项。
3. 验证“稍后提醒”的持久化行为，避免每个页面重复弹出。

### BUG-004 当前源码存在中文乱码文本风险

严重级别：P1

影响范围：企业技能页面、侧边栏企业技能入口、用户可见文案

现象：

源码中企业技能相关中文文案呈现为乱码，例如：

| 文件 | 示例 |
| --- | --- |
| `hermes-web-ui/packages/client/src/views/hermes/EnterpriseSkillsView.vue` | `鍔犺浇浼佷笟鎶€鑳藉け璐?` |
| `hermes-web-ui/packages/client/src/components/layout/AppSidebar.vue` | `浼佷笟鎶€鑳?` |

影响：

虽然 `npm run build` 可以通过，但若该页面在修复路由后上线，用户会看到乱码文案。

建议：

1. 将企业技能相关 Vue 文件按 UTF-8 修复为正常中文。
2. 优先迁移到现有 `i18n` 文案体系，避免硬编码中文。
3. 修复后用浏览器截图确认显示效果。

### BUG-005 侧边栏折叠分组中的隐藏导航项仍会被文本定位命中

严重级别：P2

影响范围：自动化测试稳定性、键盘/辅助技术定位风险

现象：

可见浏览器测试中，点击“历史”“群聊(beta)”时，脚本定位到了 DOM 中已隐藏的同名文本，Playwright 报告元素不可见，最终未完成点击。

影响：

人工点击可通过展开分组规避，但这说明隐藏导航项仍保留在 DOM 文本定位路径里。对自动化测试、可访问性和键盘导航来说，可能造成不稳定或误判。

证据：

| 证据 | 路径 |
| --- | --- |
| 可见浏览器审计 | `codex-docs/cs-docs/browser-visible/visible-browser-audit.json` |
| 历史导航截图 | `codex-docs/cs-docs/browser-visible/nav-history.png` |
| 群聊导航截图 | `codex-docs/cs-docs/browser-visible/nav-group-chat.png` |

建议：

1. 折叠分组时给隐藏导航容器设置更明确的不可访问状态，例如 `aria-hidden`。
2. 自动化测试改用可见 `RouteLinkItem` 或 route name 级定位，避免同名隐藏文本。
3. 验证分组展开/收起后键盘焦点不会进入隐藏项。

## 6. 可见浏览器补测

本轮在可见 Chromium 窗口中执行，覆盖真实点击和截图，不仅是无头巡检。

| 场景 | 结果 |
| --- | --- |
| 打开 `http://127.0.0.1:8649/#/` | 成功 |
| 使用默认账号登录 | 成功 |
| 关闭“请修改默认账户和密码”弹窗 | 成功 |
| 点击任务、看板、频道、技能、插件、MCP、记忆、模型、日志、用量、性能、技能用量、编程工具、版本预览、设备、设置 | 页面可进入 |
| 直接访问 `/hermes/enterprise-skills` | 失败，主区域空白，路由未匹配 |
| 聊天输入框输入“测试输入，不发送” | 成功，未点击发送 |
| 移动端 `390 x 844` 聊天页面 | 可加载，底部输入区可见 |

新增证据：

| 证据 | 路径 |
| --- | --- |
| 可见浏览器测试脚本 | `codex-docs/cs-docs/browser-visible-test.cjs` |
| 可见浏览器审计 JSON | `codex-docs/cs-docs/browser-visible/visible-browser-audit.json` |
| 可见浏览器截图目录 | `codex-docs/cs-docs/browser-visible/` |

## 7. 权限测试结果

| 场景 | 结果 |
| --- | --- |
| 未登录访问 `/hermes/chat` | 会重定向登录，符合预期 |
| `super_admin` 访问普通页面 | 可访问 |
| `super_admin` 访问超级管理员页面 | 可访问 |
| 模拟普通 `admin` 访问 `/hermes/enterprise-skills` | 当前被踢回登录并触发 401，因服务路由/API 未同步，需在 BUG-001/BUG-002 修复后重测 |

## 8. 构建测试

命令：

```powershell
npm run build
```

目录：

```text
hermes-web-ui
```

结果：通过。

构建警告：

| 类型 | 内容 |
| --- | --- |
| chunk 体积 | 部分 chunk 超过 `1000 kB` |
| plugin timing | `vite:vue`、`vite:css-post`、`vite:css` 等耗时较高 |

结论：

构建可作为发布前门禁，但不能证明当前 `8649` 运行服务已经加载最新代码。本次核心问题发生在运行服务同步和路由/API挂载层。

## 9. 复测建议

修复 BUG-001 和 BUG-002 后，建议按以下顺序复测：

1. 重启 `8649` 服务。
2. 访问 `/src/router/index.ts`，确认包含 `/hermes/enterprise-skills`。
3. 登录 `super_admin`，确认侧边栏出现“企业技能”入口。
4. 访问 `/#/hermes/enterprise-skills`，确认页面标题、列表、表单正常显示且无乱码。
5. 调用 `GET /api/enterprise/skills`，确认返回 `200`。
6. 新建一条企业 Skill，确认返回成功并出现在列表。
7. 勾选/取消“创建后发布”，分别验证草稿和发布状态。
8. 普通 admin 访问企业技能管理页，应按产品预期重定向或禁止访问。
9. 移动端访问企业技能页，确认表单和列表响应式布局正常。

## 10. 总结

当前系统基础功能可用，但新增企业技能功能在当前运行环境中没有真正挂载成功：前端路由不匹配，后端接口 404。这类问题会导致用户完全无法使用该功能，建议作为上线前阻塞项处理。

默认账号安全弹窗是合理的安全机制，但会影响测试自动化和页面操作，建议测试环境先处理账号密码或在自动化前显式关闭弹窗。
