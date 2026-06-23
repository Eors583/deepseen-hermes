# Hermes 本地启动与 WebSocket 排障记录

更新时间：2026-06-18

## 当前本地运行链路

本地 Web 页面接入的是 Hermes 原生 FastAPI dashboard 后端，不是 Koa。

```text
浏览器
  -> http://127.0.0.1:8649
  -> Vite dev server
  -> Vite proxy
  -> http://127.0.0.1:9119
  -> Hermes 原生 FastAPI dashboard 后端
```

关键端口：

- `8649`：前端 dev server。
- `9119`：Hermes 原生 FastAPI dashboard 后端。

## 启动原则

本地开发时以前后端分开启动为准：

1. 先启动 Hermes FastAPI dashboard 后端，监听 `127.0.0.1:9119`。
2. 再启动前端 Vite dev server，监听 `127.0.0.1:8649`。
3. 浏览器访问 `http://127.0.0.1:8649/#/hermes/chat`。

前端的 `/api` 和 `/api/ws` 请求通过 Vite proxy 转发到 `http://127.0.0.1:9119`。

## HERMES_HOME

本项目本地调试必须使用项目内 Hermes Home：

```text
D:\Users\Administrator\Desktop\hermes-agent-main\.hermes
```

不要读取或依赖全局 Hermes 目录，例如：

```text
C:\Users\Administrator\AppData\Local\hermes
```

## WebSocket 鉴权链路

前端登录后使用登录 JWT 调用：

```text
POST /api/auth/ws-ticket
```

后端返回一次性 ticket 后，前端连接：

```text
/api/ws?ticket=...
```

在本地 dev server 下，实际链路是：

```text
ws://127.0.0.1:8649/api/ws?ticket=...
  -> Vite proxy
  -> ws://127.0.0.1:9119/api/ws?ticket=...
```

## 已修复问题

现象：

```text
Error: Hermes gateway websocket failed
```

根因：

前端在 `8649` 下用登录 JWT 获取 `/api/auth/ws-ticket`，然后连接 `/api/ws?ticket=...`；但本地 FastAPI 后端处于 `loopback` 模式时，原逻辑只接受内部 `_SESSION_TOKEN`，不接受 ticket，导致 WebSocket 在 accept 前被拒绝。

修复：

`/api/ws` 鉴权逻辑已调整为：无论当前是 `loopback` 模式还是 password auth 模式，只要携带有效 ticket，都允许建立 WebSocket。

同时已增加 `/api/ws` 接受/拒绝日志，后续排查可以直接看拒绝原因。

验证结果：

```text
ws://127.0.0.1:9119/api/ws?ticket=...  OK
ws://127.0.0.1:8649/api/ws?ticket=...  OK
```

日志示例：

```text
gateway ws accepted peer=127.0.0.1 mode=loopback cred=ticket
```

## 下次排障顺序

如果再次出现 `Hermes gateway websocket failed`：

1. 确认后端 `9119` 正常运行。
2. 确认前端 `8649` 的 Vite proxy 指向 `http://127.0.0.1:9119`。
3. 登录后先测试 `/api/auth/me` 是否返回 `200`。
4. 再测试 `/api/auth/ws-ticket` 是否返回 ticket。
5. 看后端日志中的 `gateway ws accepted` 或 `gateway ws auth rejected`。
6. 如果直连 `9119` 成功但 `8649` 失败，优先查 Vite websocket proxy。
7. 如果两边都失败，优先查 FastAPI `/api/ws` 鉴权逻辑和 ticket 存储。

