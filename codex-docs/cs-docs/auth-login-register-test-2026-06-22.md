# 登录/注册认证测试记录

测试时间：2026-06-22 14:40 左右  
测试环境：本地隔离 Web 服务 `http://127.0.0.1:18649/#/`，开启 `HERMES_WEB_PASSWORD_AUTH=1`  
测试账号：`codexqa_1782110449992` / `Passw0rd123!`

## 结论

当前前端登录/注册主链路通过：

- 未登录直接访问 `#/hermes/chat` 会被重定向回登录页 `#/`。
- 注册新账号后会自动进入 `#/hermes/chat`，侧边栏显示当前用户名，聊天输入框可见。
- 退出登录后回到登录页。
- 使用已注册账号重新登录后可进入 `#/hermes/chat`。
- 刷新聊天页后仍保持登录态，说明 token 已持久化并被前端继续使用。
- 错误密码登录不会进入软件，页面停留在登录页并显示 `Login failed`。
- 接口层验证：`/api/auth/login` 返回 token，token 是 JWT 三段式结构；携带 `Authorization: Bearer <token>` 访问 `/api/auth/me` 返回 200；无 token 访问 `/api/auth/me` 返回 401。

## 通过项

| 编号 | 场景 | 结果 |
| --- | --- | --- |
| AUTH-001 | 未登录访问 `#/hermes/chat` | 通过，自动回到 `#/` 登录页 |
| AUTH-002 | 打开注册表单 | 通过，出现用户名、密码、确认密码、注册并登录按钮 |
| AUTH-003 | 注册新用户 | 通过，注册后自动进入聊天页 |
| AUTH-004 | 注册后主功能可见 | 通过，侧边栏显示用户，聊天输入框可见 |
| AUTH-005 | 退出登录 | 通过，回到登录页 |
| AUTH-006 | 已注册用户重新登录 | 通过，进入聊天页 |
| AUTH-007 | 刷新后登录态保持 | 通过，仍停留在 `#/hermes/chat`，未回到登录页 |
| AUTH-008 | 错误密码登录 | 通过，停留登录页并提示 `Login failed` |
| AUTH-009 | 无 token 访问认证接口 | 通过，`/api/auth/me` 返回 401 |
| AUTH-010 | Bearer token 访问认证接口 | 通过，`/api/auth/me` 返回当前用户 |

## 复测结论

### AUTH-RISK-001 `/auth/password-login` cookie 会话认证已修复

严重级别：中  
影响范围：历史 dashboard password-login/cookie 会话链路，不是当前前端 `LoginView` 使用的 `/api/auth/login` JWT 主链路。  
当前状态：已修复，复测通过。

复测命令：

```bash
python -m pytest -o addopts='' tests\hermes_cli\test_dashboard_auth_password_login.py -q
```

最新复测结果：

```
4 passed, 1 warning in 1.04s
```

复测说明：

- `/auth/password-login` cookie 会话链路相关自动化用例已全部通过。
- 原先两个失败点，即登录后 cookie 会话访问 `/api/auth/me` 返回 401、refresh token cookie 自动刷新失败，本轮未再复现。

## 本次未发现的问题

- 没发现未登录用户能直接进入聊天页的问题。
- 没发现注册后无法自动登录的问题。
- 没发现登录后刷新丢失登录态的问题。
- 没发现错误密码可绕过登录的问题。

## 备注

本次浏览器运行时不能直接读取页面 `localStorage` 内容，因此 token 保存采用间接验证：登录成功后刷新受保护页面仍保持在 `#/hermes/chat`；同时通过源码确认前端使用 `setApiKey()` 写入 `localStorage.hermes_api_key`，并通过接口确认 token 是有效 JWT。

## 桌面端补充复测

复测时间：2026-06-22 16:23 左右  
复测方式：使用 Playwright Electron 拉起独立桌面测试实例，隔离 `HERMES_HOME` 与 Electron `userData`，不污染本机已有账号。  
测试账号：`desktopqa_<timestamp>` / `Passw0rd123!`

### 结论

桌面端登录/注册认证本身通过，但登录后主功能仍可能不可用，原因不是没有保存 token，而是桌面端内部网关 WebSocket 连接失败。

### 已验证通过

- 桌面端真实 Electron 窗口启动后显示登录页。
- 注册后页面从登录页进入桌面端首页，URL 保持 `http://127.0.0.1:5174/`，这是桌面端 `NEW_CHAT_ROUTE = '/'` 的首页/新建会话页。
- 注册/登录后 `localStorage.herbound_auth_token` 存在，且是 JWT 三段式结构。
- 刷新桌面端页面后 token 仍存在，说明桌面端 token 已持久化。
- 临时 `HERMES_HOME` 下生成了 `web-auth/auth.db` 与 `web-auth/jwt.secret`，说明注册账号已写入本地认证库。

### 新发现问题

#### DESKTOP-AUTH-001 登录后进入首页但网关连接失败，导致软件不可正常使用

严重级别：高  
影响范围：Electron 桌面端登录后的实际可用性。  
当前状态：待开发修复。

现象：

- 注册/登录后能进入桌面端首页，但首页显示：`桌面启动失败：Could not connect to Herbound gateway`。
- 页面状态显示 `网关 离线` / `CONNECTING`。
- 控制台出现 WebSocket 403：

```text
WebSocket connection to 'ws://127.0.0.1:9121/api/ws?token=...' failed: Error during WebSocket handshake: Unexpected response code: 403
```

后端日志：

```text
WARNING hermes_cli.web_server: gateway ws auth rejected reason=no_credential mode=loopback cred=none peer=127.0.0.1
```

桌面日志：

```text
[boot] could not read served dashboard token (Hermes backend): 404: {"error":"Frontend not built. Run: cd web && npm run build"}
[boot] Hermes backend is ready. Finalizing desktop startup
```

判断：

- 桌面端账号 JWT 保存是正常的。
- 桌面端登录成功后也确实进入了首页 `/`。
- 真正阻断“正常使用软件”的是桌面主进程/渲染进程与本地 Hermes backend 的 `/api/ws` 鉴权凭证链路。
- 当前本地开发环境下，后端无法读取 served dashboard token，并且 `/api/ws` 最终收到的请求被判定为没有有效 credential。

开发建议：

- 检查 `apps/desktop/electron/main.cjs` 中 `adoptServedDashboardToken()` 失败后是否可靠回退到 spawn token。
- 检查 `window.hermesDesktop.getGatewayWsUrl()` 返回给渲染端的 URL 是否实际包含后端认可的 `token` 或 `ticket`。
- 检查 `hermes_cli/web_server.py` 的 `_ws_auth_reason()` 是否在 `password_auth_required=True` 的桌面本地模式下期望 `ticket/internal`，而桌面端仍使用 legacy `token`。
- 补充桌面端 E2E：登录/注册后不仅检查 token，还必须检查 gateway WebSocket 成功 open，且首页不出现 `Could not connect to Herbound gateway`。
