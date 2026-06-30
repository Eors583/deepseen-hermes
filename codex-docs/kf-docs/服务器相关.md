# Herbound 服务器生产上线交接文档

日期：2026-06-30  
项目：`deepseen-hermes` / Herbound  
部署方式：Docker Compose  
目标：Herbound 后端、Web 端、桌面端都连接 DeepSeen 生产账号体系和生产数据库。

## 1. 当前线上架构

Herbound 生产环境由两个主要容器组成：

| 容器 | 作用 | 对外暴露 |
| --- | --- | --- |
| `deepseen-hermes` | Herbound FastAPI / Hermes dashboard 后端 | Docker 内网 `9119` |
| `deepseen-hermes-web` | Nginx 静态 Web + `/api` 反代 | 宿主机 `9119` |

数据库使用 DeepSeen 生产 PostgreSQL，不再使用 Herbound 独立 SQLite。

Herbound 登录体系以 DeepSeen 为主：

- 用户账号密码读取 DeepSeen 生产库中的用户表。
- JWT 必须使用 DeepSeen 后端同一套 `JWT_SECRET`。
- Herbound 自己新增的数据只写入 `herbound_*` 相关表，不改 DeepSeen 原有表结构。

## 2. 服务器目录

线上项目目录：

```bash
cd /opt/viralforge-j/deepseen-hermes
```

常用文件：

```bash
.env.prod
docker-compose.prod.yml
Dockerfile.prod
deploy/nginx/hermes-web.conf
```

其中 `.env.prod` 是生产密钥文件，必须保留在服务器，不要提交到 Git。

## 3. 生产环境变量

服务器 `.env.prod` 必须包含以下关键配置：

```bash
HERMES_WEB_BIND=0.0.0.0
HERMES_WEB_PORT=9119

HERBOUND_AUTH_PROVIDER=deepseen

# 必须和 DeepSeen 生产后端一致
JWT_SECRET=<DeepSeen 生产 JWT_SECRET>
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# 必须指向 DeepSeen 生产 PostgreSQL
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>
HERMES_DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>

# DeepSeen 工具接口
DEEPSEEN_BASE_URL=https://deepseen.ai/v1
DEEPSEEN_APP_API_URL=https://deepseen.ai/api

# 大模型配置，按项目内 .hermes/.env 或生产供应商配置填写
OPENAI_API_KEY=<model-key>
CUSTOM_API_KEY=<model-key>
OPENAI_BASE_URL=https://api.ominilink.ai/v1
CUSTOM_BASE_URL=https://api.ominilink.ai/v1
```

如果 Herbound 容器和 DeepSeen PostgreSQL 不在同一个 Docker 网络，可以临时使用宿主机网关 IP，例如：

```bash
DATABASE_URL=postgresql://<user>:<password>@172.19.0.1:5432/<db>
HERMES_DATABASE_URL=postgresql://<user>:<password>@172.19.0.1:5432/<db>
```

如果已经加入同一个 Docker 网络，优先使用数据库容器名：

```bash
DATABASE_URL=postgresql://<user>:<password>@viralforge-postgres:5432/<db>
HERMES_DATABASE_URL=postgresql://<user>:<password>@viralforge-postgres:5432/<db>
```

## 4. 首次上线步骤

### 4.1 拉取代码

```bash
cd /opt/viralforge-j/deepseen-hermes
git pull
```

如果服务器提示本地改动阻止拉取，先确认这些改动是否只是服务器本地配置或构建产物。

常见安全处理方式：

```bash
git status --short
```

如果只想保留服务器本地配置，并以远端代码为准：

```bash
git stash push -u -m "server-local-before-prod-pull"
git pull
```

不要把 `.env.prod` 提交到 Git。

### 4.2 配置 `.env.prod`

如果还没有 `.env.prod`：

```bash
cp .env.prod.example .env.prod
vim .env.prod
```

填入 DeepSeen 生产数据库、JWT、大模型 Key。

### 4.3 构建并启动

推荐一次性构建并启动：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build hermes hermes-web
```

如果只想重建后端：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build hermes
```

如果只想重建 Web：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build hermes-web
```

注意：当前生产推荐使用 DeepSeen 生产 PostgreSQL，不要启动 `standalone-db` profile，除非明确要使用 Herbound 独立数据库。

不要执行：

```bash
docker compose --profile standalone-db up -d postgres
```

除非这是测试环境。

## 5. 上线后检查

### 5.1 查看容器状态

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

正常状态应类似：

```text
deepseen-hermes       Up ... healthy
deepseen-hermes-web   Up ... healthy
```

### 5.2 查看日志

```bash
docker logs --tail=200 deepseen-hermes
docker logs --tail=200 deepseen-hermes-web
```

### 5.3 检查接口

```bash
curl -i http://127.0.0.1:9119/api/auth/status
curl -i http://127.0.0.1:9119/healthz
```

### 5.4 验证登录

用 DeepSeen 已存在用户登录 Herbound Web 或桌面端。

如果命令行验证：

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:9119/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<DeepSeen账号>","password":"<密码>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

echo "TOKEN_LEN=${#TOKEN}"

curl -i -X POST http://127.0.0.1:9119/api/auth/ws-ticket \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\"}"
```

`ws-ticket` 返回 `200 OK` 才表示桌面端 / Web 对话 WebSocket 登录链路正常。

## 6. 桌面端生产包配置

桌面端生产包构建时会写入连接配置：

```bash
HERBOUND_PROD_REMOTE_URL=http://43.103.52.24:9119
HERBOUND_PROD_REMOTE_AUTH_MODE=jwt
HERBOUND_DEEPSEEN_APP_API_URL=https://deepseen.ai/api
```

本地打包命令：

```powershell
$env:HERBOUND_PROD_REMOTE_URL='http://43.103.52.24:9119'
$env:HERBOUND_PROD_REMOTE_AUTH_MODE='jwt'
$env:HERBOUND_DEEPSEEN_APP_API_URL='https://deepseen.ai/api'
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npm run --workspace apps/desktop dist:win
```

产物路径：

```text
apps/desktop/release/Herbound-0.15.1-win-x64.exe
apps/desktop/release/Herbound-0.15.1-win-x64.msi
```

安装版日志路径：

```text
C:\Users\Administrator\AppData\Local\hermes\logs\desktop.log
```

## 7. 常见问题处理

### 7.1 `container deepseen-hermes is unhealthy`

查看后端日志：

```bash
docker logs --tail=300 deepseen-hermes
```

重点检查：

- `DATABASE_URL` 是否能连到 DeepSeen PostgreSQL。
- `JWT_SECRET` 是否为空或和 DeepSeen 不一致。
- 模型 Key 是否缺失。
- 数据库网络是否跨 Docker network 不通。

在容器内检查环境变量：

```bash
docker exec deepseen-hermes env | grep -E 'DATABASE_URL|HERMES_DATABASE_URL|HERBOUND_AUTH_PROVIDER|JWT_SECRET'
```

### 7.2 数据库连接失败

查看容器网络：

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Networks}}' | grep -E 'postgres|deepseen|hermes'
docker inspect deepseen-hermes --format '{{json .NetworkSettings.Networks}}'
```

如果 Herbound 和 PostgreSQL 不在同一网络，`postgres:5432` 可能无法解析。可以临时使用宿主机网关 IP，例如 `172.19.0.1:5432`。

### 7.3 端口占用

如果启动 PostgreSQL 报：

```text
bind: address already in use
```

说明宿主机端口已经被其他数据库占用。生产环境不建议启动 Herbound 独立 postgres，直接使用 DeepSeen 生产 PostgreSQL。

如果确实要启动独立测试库，修改 `.env.prod`：

```bash
POSTGRES_PORT=55432
```

### 7.4 Web 容器 Nginx 报 `unknown directive "﻿server"`

这是 `deploy/nginx/hermes-web.conf` 文件带 BOM 导致。

修复方式：

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('deploy/nginx/hermes-web.conf')
s = p.read_text(encoding='utf-8-sig')
p.write_text(s, encoding='utf-8')
PY
```

然后重建 Web：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build hermes-web
```

### 7.5 WebSocket 401 / `/api/auth/ws-ticket: HTTP 401`

排查顺序：

1. 浏览器或桌面端是否已经重新登录。
2. `JWT_SECRET` 是否和 DeepSeen 一致。
3. `HERBOUND_AUTH_PROVIDER=deepseen` 是否生效。
4. Nginx 是否透传 `Authorization`。

当前 Nginx 配置里 `/api/` 已包含：

```nginx
proxy_set_header Authorization $http_authorization;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### 7.6 对话报 `No inference provider configured`

说明模型供应商 Key 或 Base URL 没有进入容器。

检查：

```bash
docker exec deepseen-hermes env | grep -E 'OPENAI|CUSTOM|OMINILINK|GEMINI|GOOGLE'
```

如果缺失，在 `.env.prod` 中补齐后重启：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build hermes
```

### 7.7 磁盘满

查看磁盘：

```bash
df -h /
docker system df
```

安全清理 Docker 构建缓存：

```bash
docker builder prune -af
docker image prune -af
docker container prune -f
```

不要删除 PostgreSQL volume，除非已经确认有备份。

## 8. 数据库交接说明

Herbound 生产应该连接 DeepSeen 生产 PostgreSQL。

原则：

- 不修改 DeepSeen 原有用户表字段。
- 使用 DeepSeen 用户账号密码登录。
- Herbound 独有数据新增独立表，如 `herbound_*`。
- 用户沉淀的 skill 必须按用户隔离，不允许用户 A 的 skill 被用户 B 注入提示词。

建议交接时确认以下表是否存在：

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'herbound_%'
order by table_name;
```

## 9. 更新发布流程

每次上线建议按以下流程：

```bash
cd /opt/viralforge-j/deepseen-hermes

git status --short
git pull

docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build hermes hermes-web

docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker logs --tail=100 deepseen-hermes
docker logs --tail=100 deepseen-hermes-web
```

上线后访问：

```text
http://43.103.52.24:9119
```

桌面端安装包需要单独在本地打包后分发，服务器更新不会自动更新用户已经安装的桌面端。

## 10. 回滚方案

如果新版本启动失败：

```bash
git log --oneline -5
git checkout <上一个可用commit>
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build hermes hermes-web
```

如果只是 Web 容器异常：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build hermes-web
```

如果只是后端异常：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build hermes
```

回滚前不要删除数据库 volume，不要执行 `docker compose down -v`。

