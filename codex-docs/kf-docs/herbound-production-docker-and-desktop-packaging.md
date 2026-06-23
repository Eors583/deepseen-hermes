# Herbound 生产后端 Docker 与桌面端打包说明

## 后端生产部署

生产环境只启动 FastAPI 后端、PostgreSQL 和 Web 前端容器，不依赖桌面端本地 SQLite。

```bash
cd /opt/viralforge-j/deepseen-hermes
cp .env.prod.example .env.prod
vi .env.prod
docker compose -f docker-compose.prod.yml up -d --build postgres hermes hermes-web
docker compose -f docker-compose.prod.yml ps
```

`.env.prod` 至少要确认：

```bash
HERMES_WEB_BIND=0.0.0.0
HERMES_WEB_PORT=9119
POSTGRES_DB=hermes
POSTGRES_USER=hermes
POSTGRES_PASSWORD=change-me-before-prod
POSTGRES_BIND=127.0.0.1
POSTGRES_PORT=5432
HERMES_DATABASE_URL=postgresql://hermes:change-me-before-prod@postgres:5432/hermes
DATABASE_URL=postgresql://hermes:change-me-before-prod@postgres:5432/hermes
```

`hermes` 容器内后端通过 `HERMES_DATABASE_URL` / `DATABASE_URL` 连接 PostgreSQL。桌面端用户登录、DeepSeen Key、企业/部门/员工、用户独立 skill 都应写入这套 PostgreSQL。

本地可直接生成带开发环境模型 Key 的生产 `.env.prod`：

```powershell
cd D:\Users\Administrator\Desktop\hermes-agent-main
powershell -ExecutionPolicy Bypass -File scripts\write-prod-env-from-local.ps1
```

生成出的 `.env.prod` 不提交 Git。上线时上传到服务器项目根目录：

```bash
scp .env.prod root@你的服务器IP:/opt/viralforge-j/deepseen-hermes/.env.prod
```

PostgreSQL 默认只暴露在服务器本机 `127.0.0.1:5432`。Navicat 推荐用 SSH 隧道连接：

```text
SSH: root@服务器IP:22
数据库主机: 127.0.0.1
端口: 5432
数据库: hermes
用户: hermes
密码: .env.prod 里的 POSTGRES_PASSWORD
```

如果必须公网直连数据库，把 `.env.prod` 的 `POSTGRES_BIND=127.0.0.1` 改成 `POSTGRES_BIND=0.0.0.0`，并只对白名单 IP 开放 5432 端口。

## 桌面端生产打包

打包前设置生产后端地址，安装包会内置 `production-connection.json`。首次启动时如果用户没有自己的 `connection.json`，桌面端会默认连接这个线上 FastAPI 后端。

PowerShell：

```powershell
cd D:\Users\Administrator\Desktop\hermes-agent-main
$env:HERBOUND_PROD_REMOTE_URL="http://你的服务器IP:9119"
$env:HERBOUND_PROD_REMOTE_AUTH_MODE="jwt"
npm run --workspace apps/desktop dist:win
```

如果已经绑定域名和 HTTPS：

```powershell
$env:HERBOUND_PROD_REMOTE_URL="https://你的域名"
$env:HERBOUND_PROD_REMOTE_AUTH_MODE="jwt"
npm run --workspace apps/desktop dist:win
```

生产桌面端使用 `/api/auth/login` 登录，登录成功后保存 7 天 JWT。对话 WebSocket 会使用该 JWT 调 `/api/auth/ws-ticket` 换取短期 ticket，不再依赖本地数据库或本地 Hermes 后端。

## 验证

```bash
curl http://127.0.0.1:9119/api/status
curl -s -X POST http://127.0.0.1:9119/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"123456"}'
```

桌面端打包后验证：

1. 首次打开不应出现本地工作区/本地数据库启动依赖。
2. 登录账号后进入主界面。
3. 新建对话能正常连接网关并返回消息。
4. 生成或总结出的用户 skill 同时落本地和 PostgreSQL，并按用户隔离。
