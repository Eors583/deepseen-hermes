# Herbound Desktop 本地启动说明

日期：2026-06-23

## 必须连接的数据库

本地桌面端必须连接 PostgreSQL，不再使用 SQLite。

本机开发数据库：

```text
Host: 127.0.0.1
Port: 55432
Database: hermes
User: hermes
Password: change-me-before-prod
URL: postgresql://hermes:change-me-before-prod@127.0.0.1:55432/hermes
```

对应环境变量：

```powershell
$env:HERMES_DATABASE_URL = "postgresql://hermes:change-me-before-prod@127.0.0.1:55432/hermes"
$env:DATABASE_URL = $env:HERMES_DATABASE_URL
$env:HERMES_HOME = "D:\Users\Administrator\Desktop\hermes-agent-main\.hermes"
$env:PYTHONPATH = "D:\Users\Administrator\Desktop\hermes-agent-main"
```

## 启动顺序

1. 先启动 Docker Desktop。
2. 确认 PostgreSQL 容器存在并监听 `127.0.0.1:55432`。
3. 启动桌面端。

推荐命令：

```powershell
cd D:\Users\Administrator\Desktop\hermes-agent-main
powershell -ExecutionPolicy Bypass -File .\scripts\start-desktop-dev.ps1
```

如果手动启动，必须带上数据库环境变量：

```powershell
cd D:\Users\Administrator\Desktop\hermes-agent-main
$env:HERMES_DATABASE_URL = "postgresql://hermes:change-me-before-prod@127.0.0.1:55432/hermes"
$env:DATABASE_URL = $env:HERMES_DATABASE_URL
$env:HERMES_HOME = "D:\Users\Administrator\Desktop\hermes-agent-main\.hermes"
$env:PYTHONPATH = "D:\Users\Administrator\Desktop\hermes-agent-main"
npm run --workspace apps/desktop dev
```

## 验证数据库是否连通

```powershell
cd D:\Users\Administrator\Desktop\hermes-agent-main
$env:HERMES_DATABASE_URL = "postgresql://hermes:change-me-before-prod@127.0.0.1:55432/hermes"
$env:DATABASE_URL = $env:HERMES_DATABASE_URL
$env:PYTHONPATH = "D:\Users\Administrator\Desktop\hermes-agent-main"
@'
from hermes_cli import postgres_store
conn = postgres_store.connect()
try:
    print(conn.execute("select current_database() as db, current_user as usr").fetchone())
    print(conn.execute("select count(*) as skills from skill_definitions").fetchone())
finally:
    conn.close()
'@ | python -
```

正常时会返回数据库 `hermes`、用户 `hermes`，并能查到 `skill_definitions` 数量。

## 常见错误

- `DATABASE_URL/HERMES_DATABASE_URL is required`：启动桌面端时没有带数据库环境变量。
- `connection refused 127.0.0.1:55432`：Docker Desktop 或 PostgreSQL 容器没有启动。
- `container name deepseen-hermes-postgres already in use`：容器已存在，先检查是否已经运行，不需要重复创建。

检查命令：

```powershell
docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}"
Test-NetConnection 127.0.0.1 -Port 55432
```
