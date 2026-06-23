# Hermes PostgreSQL 生产存储方案

更新时间：2026-06-18

## 目标

生产环境不再把 Web 用户、DeepSeen Key、企业 Skill 等业务数据写入 SQLite 文件，统一使用 PostgreSQL。

## 已切换到 PostgreSQL 的数据

- Web 登录用户：`users`
- 用户可用 Profile：`user_profiles`
- DeepSeen 用户 Key：`user_credentials`
- Hermes 会话、消息、标题、搜索、归档、删除：`sessions`、`messages`、`state_meta`、`compression_locks`
- Gateway Responses API 连续对话缓存：`responses`、`conversations`
- 企业组织/团队：`organizations`、`teams`
- 企业 Skill 定义、版本、附件：`skill_definitions`、`skill_versions`、`skill_files`
- 企业 Skill 权限、运行快照、使用记录、反馈、提案、审计：`skill_visibility_rules`、`skill_runtime_snapshots`、`skill_usage_events`、`skill_feedback`、`skill_proposals`、`skill_audit_logs`

## PostgreSQL 生产保护

以下模块原生仍是 SQLite 大模块，当前生产模式下已禁止继续写 SQLite：

- Kanban/任务板：`hermes_cli/kanban_db.py`
- RetainDB memory 插件写入队列：`plugins/memory/retaindb`
- Holographic memory 插件本地 store：`plugins/memory/holographic`

也就是说，配置了 `HERMES_DATABASE_URL` / `DATABASE_URL` 后，这些模块不会再偷偷创建 `.db` 文件；如果被调用会明确报错，避免线上继续产生 SQLite 数据。它们要恢复生产可用，需要继续做各自的 PostgreSQL 方言适配。

## 生产配置

`docker-compose.prod.yml` 已包含 PostgreSQL 服务：

```text
deepseen-hermes-postgres
deepseen-hermes
deepseen-hermes-web
```

`.env.prod` 必须配置：

```env
POSTGRES_DB=hermes
POSTGRES_USER=hermes
POSTGRES_PASSWORD=请换成强密码
```

Compose 会自动为 FastAPI 后端注入：

```env
HERMES_DATABASE_URL=postgresql://...
DATABASE_URL=postgresql://...
```

代码读取顺序：

1. `HERMES_DATABASE_URL`
2. `DATABASE_URL`
3. `POSTGRES_URL`
4. `POSTGRESQL_URL`

只要配置了其中任意一个，认证、DeepSeen Key、企业 Skill 存储都会走 PostgreSQL。

## 从旧 SQLite 迁移数据

如果服务器已经有旧数据，先启动 PostgreSQL，再执行：

```bash
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml run --rm hermes python /app/scripts/migrate_sqlite_to_postgres.py
```

迁移脚本会读取：

```text
/opt/data/web-auth/auth.db
/opt/data/enterprise-skills/enterprise_skills.db
```

并导入 PostgreSQL。

## 上线启动

首次上线：

```bash
cp .env.prod.example .env.prod
vim .env.prod
docker compose -f docker-compose.prod.yml up -d --build
```

后续更新：

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## 注意

当前这次切换覆盖 FastAPI 生产核心业务数据：用户、DeepSeen Key、会话历史、消息、Responses API 缓存、企业 Skill。

Kanban 等上游原生模块当前已做 PostgreSQL 生产保护，但功能本身还没有完成 PostgreSQL 方言适配。
