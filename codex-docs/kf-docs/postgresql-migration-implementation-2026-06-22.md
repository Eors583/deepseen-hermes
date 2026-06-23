# Herbound PostgreSQL 存储迁移说明

日期：2026-06-22

## 当前后端与数据库入口

- 后端框架：Hermes 原生 FastAPI dashboard 后端，另有 gateway OpenAI-compatible API adapter。
- 数据库访问：项目没有统一 ORM，主要是 DB-API 风格 `conn.execute(...)`；PostgreSQL 通过 `hermes_cli/postgres_store.py` 包装 `psycopg`。
- 生产连接配置：读取 `HERMES_DATABASE_URL`，兼容 `DATABASE_URL`、`POSTGRES_URL`、`POSTGRESQL_URL`。
- 生产 Docker：`docker-compose.prod.yml` 已包含 `postgres:16-alpine`，FastAPI 容器通过 `postgres` 服务名连接。
- SQLite 历史文件：
  - `~/.hermes/web-auth/auth.db`
  - `~/.hermes/enterprise-skills/enterprise_skills.db`
  - `~/.hermes/state.db`
  - `~/.hermes/response_store.db`

## 已迁移的生产后端存储

- Web 登录/注册/用户/角色：`hermes_cli/web_auth.py`
- DeepSeen 用户 Key：`hermes_cli/deepseen_credentials.py`
- 企业技能库：`hermes_cli/enterprise_skills/db.py`、`service.py`
- 会话历史：`hermes_cli/postgres_session_db.py`，由 `hermes_state.SessionDB()` 在配置 PostgreSQL 时自动切换
- OpenAI Responses 状态：`gateway/platforms/api_server.py::ResponseStore`

## 方言风险与处理

- 自增主键：SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` 改为 PostgreSQL `BIGSERIAL`，迁移后执行 sequence 修复。
- 时间字段：保留原有毫秒/浮点时间戳字段，避免改变 API 响应格式。
- Boolean：继续使用 `INTEGER 0/1` 存储兼容旧响应，避免前端字段变化。
- JSON：继续使用 TEXT 存储 JSON 字符串，避免接口和旧数据结构变化。
- UPSERT：`INSERT OR IGNORE/REPLACE` 已替换为 `ON CONFLICT ... DO NOTHING/DO UPDATE`。
- COUNT 取值：PostgreSQL dict row 与旧 `row[0]` 不兼容，`PgCompatRow` 同时支持字段名和下标读取。
- FTS5：SQLite 会话全文索引不迁移为 PostgreSQL tsvector，本次用 `ILIKE` 保持搜索可用；后续可单独优化全文搜索。
- 外键：PostgreSQL 默认严格执行外键，迁移顺序按父表到子表导入。
- 锁行为：PostgreSQL 不再使用 WAL/PRAGMA，原 SQLite 文件锁问题消失。

## 生产环境配置

`.env.prod` 至少包含：

```bash
POSTGRES_DB=hermes
POSTGRES_USER=hermes
POSTGRES_PASSWORD=请换成强密码

HERMES_WEB_BIND=0.0.0.0
HERMES_WEB_PORT=9119

HERMES_DATABASE_URL=postgresql://hermes:请换成强密码@postgres:5432/hermes
DATABASE_URL=postgresql://hermes:请换成强密码@postgres:5432/hermes
```

## SQLite 数据迁移到 PostgreSQL

首次上线或从旧版本升级时：

```bash
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml run --rm hermes python scripts/migrate_sqlite_to_postgres.py
docker compose -f docker-compose.prod.yml up -d --build hermes hermes-web
```

迁移脚本会：

- 初始化 PostgreSQL 表结构、索引、唯一约束和外键。
- 从历史 SQLite 文件逐表读取。
- 只导入目标 PostgreSQL 表存在的列。
- 使用 `ON CONFLICT DO NOTHING` 避免重复导入。
- 输出每张表的 `sqlite / inserted / postgresql` 行数。
- 修复 `users.id`、`messages.id` 的 sequence next value。

## 验证命令

本地无 PostgreSQL 时可以运行无数据库回归：

```bash
python -m py_compile hermes_cli/postgres_store.py hermes_cli/web_auth.py hermes_cli/deepseen_credentials.py hermes_cli/enterprise_skills/db.py hermes_cli/enterprise_skills/service.py hermes_cli/postgres_session_db.py gateway/platforms/api_server.py scripts/migrate_sqlite_to_postgres.py
pytest -o addopts='' tests/hermes_cli/test_postgres_store.py -q
pytest -o addopts='' tests/gateway/test_api_server.py::TestResponseStore -q
pytest -o addopts='' tests/test_enterprise_skills_runtime.py -q
```

生产 PostgreSQL 可用后建议补跑：

```bash
export HERMES_DATABASE_URL='postgresql://hermes:密码@127.0.0.1:5432/hermes'
export DATABASE_URL="$HERMES_DATABASE_URL"
pytest -o addopts='' tests/hermes_cli/test_postgres_store.py tests/test_enterprise_skills_runtime.py tests/gateway/test_api_server.py::TestResponseStore -q
```

## 回滚方案

如果上线后需要回滚：

1. 停止新容器：`docker compose -f docker-compose.prod.yml down`
2. 恢复上一版代码。
3. 恢复旧 `.env.prod`。
4. 如旧版本仍使用 SQLite，保留原 `~/.hermes/*.db` 文件即可。
5. PostgreSQL 数据不要删除，可保留用于再次迁移或审计。

注意：回滚后在 PostgreSQL 中产生的新数据不会自动写回 SQLite；如果必须反向导出，需要单独写 PostgreSQL -> SQLite 迁移脚本。
