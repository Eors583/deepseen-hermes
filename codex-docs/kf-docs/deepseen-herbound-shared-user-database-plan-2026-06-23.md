# DeepSeen 与 Herbound 共用用户和数据库技术方案

日期：2026-06-23

## 目标

将 Herbound 接入 DeepSeen 现有用户体系和 PostgreSQL 主库，做到：

- 用户账号密码统一使用 DeepSeen 的用户账号密码。
- Herbound 不再维护独立用户表作为主身份来源。
- Herbound 特有的企业、部门、员工、用户技能、技能版本、技能沉淀和审计数据迁移到 DeepSeen 同一个 PostgreSQL 数据库。
- 不同用户的 skill 必须隔离，用户 A 沉淀的 skill 不会进入用户 B 的提示词。
- 保留 Herbound 智能体、对话、skill 总结和工具调用能力。
- 本次数据库设计不得修改、删除、重命名 DeepSeen 现有表、字段、索引、约束和枚举，必须保证 DeepSeen 原有 Web、API、Admin、支付、积分、任务、OpenAPI、工作流等功能继续可用。

## 2026-06-23 实施记录：Herbound 认证切到 DeepSeen 用户体系

本次已将 Herbound FastAPI 的产品登录链路切到 DeepSeen 用户体系：

- `/api/auth/login`：读取 DeepSeen PostgreSQL 的 `"User"` 表，优先用 `email` 登录，兼容用 `name` 查找；密码使用 bcrypt 校验 DeepSeen 的 `"User".password`。
- `/api/auth/me`：JWT 校验通过后回查 DeepSeen `"User"`，返回 Herbound 前端既有的 `user` 响应结构，避免改动 Web / 桌面端接口。
- `/api/auth/ws-ticket`：继续通过 `web_auth.authenticate_bearer_token()` 校验 Herbound JWT；该函数已切到 DeepSeen `"User"` 回查，因此对话 WebSocket 鉴权也使用 DeepSeen 用户。
- `/api/auth/status`：统计 DeepSeen `"User"` 表用户数量，不再依赖 Herbound 自建 `users` 表。
- `/api/auth/register`、改密、改用户名、用户管理写接口：DeepSeen 模式下禁止在 Herbound 内直接写 DeepSeen 用户表，避免绕过 DeepSeen 原有注册、邀请、积分、封禁和刷新 token 规则。
- Herbound 只应继续写 `herbound_*` 表；DeepSeen 原有表结构不做 `ALTER TABLE`。

启用方式：

```env
HERBOUND_AUTH_PROVIDER=deepseen
HERMES_DATABASE_URL=postgresql://<deepseen_user>:<deepseen_password>@<deepseen_postgres_host>:5432/<deepseen_db>
DATABASE_URL=postgresql://<deepseen_user>:<deepseen_password>@<deepseen_postgres_host>:5432/<deepseen_db>
```

生产 Docker 中，Herbound 自带 postgres 已调整为可选 `standalone-db` profile。共享 DeepSeen 数据库部署时，不要启动 Herbound 自带 postgres，只需要让 `hermes` 服务连接 DeepSeen PostgreSQL。

## 核心边界

这次融合遵循“只新增，不侵入”的原则：

```text
允许：
- 新增 herbound_* 表。
- 新增 herbound_* 索引、外键、迁移脚本。
- Herbound 只读引用 DeepSeen "User" 表作为身份来源。
- Herbound 在自己的 herbound_* 表里保存企业、部门、员工、skill 和运行数据。

不允许：
- 不修改 DeepSeen 现有表结构。
- 不修改 DeepSeen 现有字段类型。
- 不删除 DeepSeen 现有字段、索引、唯一约束、外键或枚举。
- 不重命名 DeepSeen 现有表。
- 不向 DeepSeen 现有业务表塞 Herbound 专属字段。
- 不改 DeepSeen 现有用户注册、登录、积分、支付、任务、工作流、OpenAPI 的接口行为。
```

Herbound 与 DeepSeen 的关系应是：

```text
DeepSeen 现有表：保持原样，继续服务 DeepSeen。
Herbound 新增表：全部以 herbound_ 前缀隔离。
唯一交叉点：herbound_* 表通过 user_id 外键引用 DeepSeen "User"(id)。
```

## 当前项目现状

### DeepSeen

项目路径：

```text
D:\Users\Administrator\Desktop\deepseen
```

技术栈：

```text
TypeScript
Fastify
Prisma
PostgreSQL
JWT: jose
密码：bcryptjs
```

数据库配置：

```text
packages/database/prisma/schema.prisma
datasource db -> env("DATABASE_URL")
```

用户模型：

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  emailVerified DateTime?

  password     String?
  authToken    String?   @unique
  refreshToken String?
  lastLoginAt  DateTime?
  lastLoginIp  String?

  role         UserRole   @default(USER)
  status       UserStatus @default(ACTIVE)

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

认证链路：

```text
apps/api/src/services/AuthService.ts
apps/api/src/lib/authMiddleware.ts
apps/api/src/routes/auth.ts
```

DeepSeen JWT payload：

```ts
interface TokenPayload {
  userId: string
  email: string
  type: 'access' | 'refresh'
}
```

### Herbound

项目路径：

```text
D:\Users\Administrator\Desktop\hermes-agent-main
```

技术栈：

```text
Python
FastAPI dashboard backend
Electron desktop
PostgreSQL storage adapter
```

Herbound 当前已有企业技能模块：

```text
hermes_cli/enterprise_skills/db.py
hermes_cli/enterprise_skills/service.py
hermes_cli/enterprise_skills/runtime_adapter.py
hermes_cli/enterprise_skills/routes.py
```

Herbound 当前已有迁移脚本：

```text
scripts/migrate_sqlite_to_postgres.py
```

Herbound 当前企业 skill 表：

```text
organizations
teams
user_organization_memberships
user_team_memberships
employee_profiles
employee_skill_assignments
skill_definitions
skill_versions
skill_files
skill_visibility_rules
skill_runtime_snapshots
skill_usage_events
skill_feedback
skill_proposals
skill_audit_logs
```

## 总体方案

采用一个数据库、一个用户中心、两套业务服务的结构：

```text
DeepSeen PostgreSQL
  ├─ DeepSeen 原有业务表
  ├─ "User" 统一用户表
  ├─ Team / TeamMember / CreditAccount / ApiKey 等 DeepSeen 表
  └─ herbound_* Herbound 专属业务表

DeepSeen API
  └─ 用户注册、登录、会员、积分、DeepSeen 业务

Herbound FastAPI
  └─ 智能体对话、工具调用、skill 总结、skill 加载、企业知识库
```

Herbound 不再自建独立用户身份。Herbound 中所有用户 ID 均使用 DeepSeen `"User".id`。

## 认证方案

### 推荐方案：Herbound 校验 DeepSeen JWT

DeepSeen 继续负责登录：

```text
POST /api/auth/login
```

登录成功后返回 DeepSeen accessToken。Herbound 桌面端和 Web 端保存该 accessToken。

Herbound 请求自己的接口时带：

```http
Authorization: Bearer <deepseen_access_token>
```

Herbound 后端使用与 DeepSeen 相同的 `JWT_SECRET` 校验 token：

```text
issuer = viralforge
payload.userId = DeepSeen User.id
payload.email = DeepSeen User.email
payload.type = access
```

校验通过后，Herbound 再查 DeepSeen `"User"` 表确认：

```text
用户存在
status = ACTIVE
refreshToken 不为空，未被强制下线
```

然后注入 Herbound 当前用户：

```python
current_user = {
    "id": deepseen_user.id,
    "email": deepseen_user.email,
    "name": deepseen_user.name,
    "role": deepseen_user.role,
}
```

### 不推荐方案：Herbound 自己校验密码

Herbound 也可以直接查 DeepSeen `"User".password` 并用 bcrypt 校验密码，但不推荐作为第一版：

- 会复制 DeepSeen 的登录风控逻辑。
- 容易漏掉 refresh token rotation、强制下线、封禁等规则。
- 将来 DeepSeen 登录规则变化时 Herbound 需要同步改。

因此第一版建议 Herbound 只接收和校验 DeepSeen accessToken。

## 数据库表设计

为避免与 DeepSeen 现有 `Team`、`TeamMember`、`User` 等 Prisma 表冲突，Herbound 专属表统一使用 `herbound_` 前缀。

本节所有 SQL 都是新增表或新增索引，不应对 DeepSeen 既有表执行 `ALTER TABLE`。如果后续需要在 DeepSeen Admin 后台展示 Herbound 数据，应优先通过新增 Prisma model 映射 `herbound_*` 表完成，而不是扩展 DeepSeen 既有 model。

### 企业表

```sql
CREATE TABLE IF NOT EXISTS herbound_organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_herbound_org_owner
  ON herbound_organizations(owner_user_id);
```

### 部门表

```sql
CREATE TABLE IF NOT EXISTS herbound_departments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES herbound_departments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_herbound_departments_org
  ON herbound_departments(organization_id);
```

### 员工档案表

```sql
CREATE TABLE IF NOT EXISTS herbound_employee_profiles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  employee_no TEXT,
  display_name TEXT NOT NULL,
  title TEXT,
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(organization_id, user_id),
  UNIQUE(organization_id, employee_no)
);

CREATE INDEX IF NOT EXISTS idx_herbound_employee_org_status
  ON herbound_employee_profiles(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_herbound_employee_user
  ON herbound_employee_profiles(user_id);
```

### 用户部门关系表

```sql
CREATE TABLE IF NOT EXISTS herbound_user_department_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES herbound_departments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at BIGINT NOT NULL,
  UNIQUE(department_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_herbound_user_department_org_user
  ON herbound_user_department_memberships(organization_id, user_id);
```

### Skill 定义表

```sql
CREATE TABLE IF NOT EXISTS herbound_skill_definitions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  business_domain TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  latest_version_id TEXT,
  published_version_id TEXT,
  owner_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  updated_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  archived_at BIGINT,
  UNIQUE(organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_herbound_skill_def_org_status
  ON herbound_skill_definitions(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_herbound_skill_def_owner
  ON herbound_skill_definitions(owner_user_id);
```

### Skill 版本表

```sql
CREATE TABLE IF NOT EXISTS herbound_skill_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES herbound_skill_definitions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  semver TEXT,
  content_md TEXT NOT NULL,
  frontmatter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  references_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  templates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  assets_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  tools_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  changelog TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  content_sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  reviewed_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  published_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  reject_reason TEXT,
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT,
  published_at BIGINT,
  UNIQUE(skill_id, version)
);

CREATE INDEX IF NOT EXISTS idx_herbound_skill_versions_skill_status
  ON herbound_skill_versions(skill_id, status);

CREATE INDEX IF NOT EXISTS idx_herbound_skill_versions_org_status
  ON herbound_skill_versions(organization_id, status);
```

### Skill 文件表

```sql
CREATE TABLE IF NOT EXISTS herbound_skill_files (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES herbound_skill_definitions(id) ON DELETE CASCADE,
  skill_version_id TEXT NOT NULL REFERENCES herbound_skill_versions(id) ON DELETE CASCADE,
  file_type TEXT NOT NULL,
  file_kind TEXT,
  path TEXT NOT NULL,
  content_text TEXT,
  object_url TEXT,
  mime_type TEXT,
  sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  created_at BIGINT NOT NULL,
  UNIQUE(skill_version_id, path)
);
```

### Skill 可见性表

```sql
CREATE TABLE IF NOT EXISTS herbound_skill_visibility_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES herbound_skill_definitions(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  access_level TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  created_at BIGINT NOT NULL,
  UNIQUE(skill_id, scope_type, scope_id, access_level)
);

CREATE INDEX IF NOT EXISTS idx_herbound_skill_visibility_org_scope
  ON herbound_skill_visibility_rules(organization_id, scope_type, scope_id);
```

`scope_type` 建议枚举：

```text
organization
department
user
role
```

### 员工 skill 分配表

```sql
CREATE TABLE IF NOT EXISTS herbound_employee_skill_assignments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES herbound_skill_definitions(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'use',
  assigned_by TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  created_at BIGINT NOT NULL,
  UNIQUE(organization_id, user_id, skill_id, access_level)
);

CREATE INDEX IF NOT EXISTS idx_herbound_skill_assignments_user
  ON herbound_employee_skill_assignments(organization_id, user_id);
```

### 运行快照表

```sql
CREATE TABLE IF NOT EXISTS herbound_skill_runtime_snapshots (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  profile_id TEXT,
  skill_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  version_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshot_hash TEXT NOT NULL,
  runtime_skills_dir TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  last_used_at BIGINT NOT NULL,
  UNIQUE(organization_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_herbound_skill_snapshots_org_user
  ON herbound_skill_runtime_snapshots(organization_id, user_id);
```

### 使用事件表

```sql
CREATE TABLE IF NOT EXISTS herbound_skill_usage_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  session_id TEXT,
  profile_id TEXT,
  skill_id TEXT REFERENCES herbound_skill_definitions(id) ON DELETE SET NULL,
  skill_version_id TEXT REFERENCES herbound_skill_versions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  request_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_herbound_skill_usage_org_created
  ON herbound_skill_usage_events(organization_id, created_at);
```

### Skill 提案和审计表

```sql
CREATE TABLE IF NOT EXISTS herbound_skill_proposals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_session_id TEXT,
  proposed_by TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  suggested_name TEXT,
  suggested_category TEXT,
  suggested_scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_md TEXT NOT NULL,
  source_summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  converted_skill_id TEXT REFERENCES herbound_skill_definitions(id) ON DELETE SET NULL,
  converted_version_id TEXT REFERENCES herbound_skill_versions(id) ON DELETE SET NULL,
  reviewer_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  review_comment TEXT,
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT
);

CREATE TABLE IF NOT EXISTS herbound_skill_audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES herbound_organizations(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at BIGINT NOT NULL
);
```

## DeepSeen Prisma 集成方式

建议在 DeepSeen `packages/database/prisma/schema.prisma` 中增加 Herbound 模型，方便 DeepSeen Admin 后台未来管理。

如果短期只由 Herbound 写入，也可以先用 SQL migration 建表，不立刻接入 Prisma Client。

注意：即使后续接入 Prisma，也只能新增 `Herbound*` model 映射 `herbound_*` 表，不能修改 DeepSeen 现有 `User`、`Team`、`TeamMember`、`CreditAccount`、`ApiKey` 等 model 的字段和关系。DeepSeen 现有业务模型必须保持兼容。

推荐顺序：

1. 第一阶段：SQL migration 建 `herbound_*` 表，Herbound 直接 SQL 访问。
2. 第二阶段：DeepSeen Prisma schema 增加对应 model，用 Admin 后台展示和管理。

原因：

- 第一阶段改动小，能快速上线。
- 第二阶段再让 DeepSeen 管理端接管企业、部门、员工和 skill 审核。

## Herbound 代码改造点

### 数据库连接

Herbound 生产环境：

```env
DATABASE_URL=postgresql://<deepseen_user>:<password>@<deepseen_postgres_host>:5432/<deepseen_db>
HERMES_DATABASE_URL=postgresql://<deepseen_user>:<password>@<deepseen_postgres_host>:5432/<deepseen_db>
```

Herbound `docker-compose.prod.yml` 中不再启动独立 postgres，或者保留但默认关闭。

Herbound 服务依赖从：

```text
deepseen-hermes-postgres
```

改为：

```text
DeepSeen PostgreSQL
```

### 认证中间件

新增：

```text
hermes_cli/deepseen_auth.py
```

职责：

- 从 Authorization header 读取 Bearer token。
- 用 DeepSeen `JWT_SECRET` 校验 JWT。
- 校验 `payload.type == "access"`。
- 用 `payload.userId` 查询 DeepSeen `"User"`。
- 确认用户状态为 `ACTIVE`。
- 将 DeepSeen userId 注入 Herbound request context。

### 登录接口

Herbound 当前 `/api/auth/login` 建议改为代理 DeepSeen：

```text
Herbound /api/auth/login
  -> POST DeepSeen /api/auth/login
  -> 原样返回 accessToken / refreshToken / user
```

如果桌面端必须使用 Herbound 当前响应结构，则做兼容转换：

```json
{
  "token": "<deepseen accessToken>",
  "user": {
    "id": "<deepseen userId>",
    "username": "<email or name>",
    "role": "<role>",
    "status": "<status>"
  }
}
```

### ws-ticket 接口

Herbound `/api/auth/ws-ticket`：

- 接收 DeepSeen accessToken。
- 通过 `deepseen_auth.py` 校验。
- 校验通过后签发 Herbound 短期 websocket ticket。

### Skill 加载隔离

用户进入会话时，Herbound 的 skill runtime adapter 只能加载：

```text
1. 系统内置 skill
2. 当前 organization 公开 skill
3. 当前用户所在 department 可见 skill
4. 当前用户被单独分配的 skill
5. 当前用户自己沉淀且未公开的个人 skill
```

查询条件必须包含：

```text
organization_id
user_id
department_ids
status = published
```

不能使用全局 skill 列表直接拼进提示词。

## 数据迁移方案

迁移只允许从 Herbound 旧库读取数据并写入 DeepSeen 主库的 `herbound_*` 新表。迁移脚本不得对 DeepSeen 现有业务表执行写入、更新、删除或结构变更。

### 源库

当前 Herbound PostgreSQL：

```text
deepseen-hermes-postgres
```

表：

```text
organizations
teams
user_organization_memberships
user_team_memberships
employee_profiles
employee_skill_assignments
skill_definitions
skill_versions
skill_files
skill_visibility_rules
skill_runtime_snapshots
skill_usage_events
skill_feedback
skill_proposals
skill_audit_logs
```

### 目标库

DeepSeen PostgreSQL：

```text
DeepSeen DATABASE_URL 指向的数据库
```

目标表：

```text
herbound_organizations
herbound_departments
herbound_employee_profiles
herbound_user_department_memberships
herbound_skill_definitions
herbound_skill_versions
herbound_skill_files
herbound_skill_visibility_rules
herbound_employee_skill_assignments
herbound_skill_runtime_snapshots
herbound_skill_usage_events
herbound_skill_feedback
herbound_skill_proposals
herbound_skill_audit_logs
```

### 用户 ID 映射

如果 Herbound 当前用户 ID 和 DeepSeen `"User".id` 不一致，需要迁移映射表：

```sql
CREATE TABLE IF NOT EXISTS herbound_user_migration_map (
  old_user_id TEXT PRIMARY KEY,
  deepseen_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  matched_by TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
```

映射优先级：

```text
1. email 精确匹配
2. username 与 DeepSeen email 前缀匹配
3. username 与 DeepSeen name 匹配
4. 手工指定
```

### 迁移步骤

1. 备份 DeepSeen 数据库。

```bash
docker exec <deepseen-postgres-container> pg_dump -U <user> <db> > deepseen_before_herbound.sql
```

2. 备份 Herbound 当前数据库。

```bash
docker exec deepseen-hermes-postgres pg_dump -U hermes hermes > herbound_before_merge.sql
```

3. 在 DeepSeen 库创建 `herbound_*` 表。

   该步骤只能执行 `CREATE TABLE IF NOT EXISTS herbound_*`、`CREATE INDEX IF NOT EXISTS idx_herbound_*`。禁止执行会影响 DeepSeen 既有表的 `DROP`、`TRUNCATE`、`ALTER`、`DELETE`、`UPDATE`。

4. 导入企业和部门：

```text
organizations -> herbound_organizations
teams -> herbound_departments
```

5. 导入员工：

```text
employee_profiles -> herbound_employee_profiles
user_team_memberships -> herbound_user_department_memberships
```

6. 导入 skill：

```text
skill_definitions -> herbound_skill_definitions
skill_versions -> herbound_skill_versions
skill_files -> herbound_skill_files
skill_visibility_rules -> herbound_skill_visibility_rules
employee_skill_assignments -> herbound_employee_skill_assignments
skill_runtime_snapshots -> herbound_skill_runtime_snapshots
skill_usage_events -> herbound_skill_usage_events
skill_feedback -> herbound_skill_feedback
skill_proposals -> herbound_skill_proposals
skill_audit_logs -> herbound_skill_audit_logs
```

7. 导入后校验：

```sql
SELECT COUNT(*) FROM herbound_organizations;
SELECT COUNT(*) FROM herbound_departments;
SELECT COUNT(*) FROM herbound_employee_profiles;
SELECT COUNT(*) FROM herbound_skill_definitions;
SELECT COUNT(*) FROM herbound_skill_versions;
SELECT COUNT(*) FROM herbound_employee_skill_assignments;
```

8. 启动 Herbound 指向 DeepSeen 数据库。

9. 用 DeepSeen 账号登录 Herbound。

10. 验证用户只加载自己的 skill。

## 上线部署方案

上线部署必须保证 DeepSeen 原服务使用的数据库连接、schema 和迁移历史不被破坏。Herbound 连接 DeepSeen 数据库后，只能访问 `"User"` 和 `herbound_*` 表；除用户状态校验外，不应读写 DeepSeen 其他业务表。

### Docker Compose 调整

Herbound 生产 compose 建议去掉 postgres service：

```yaml
services:
  hermes:
    env_file:
      - .env.prod
    environment:
      DATABASE_URL: ${DATABASE_URL}
      HERMES_DATABASE_URL: ${DATABASE_URL}
      DEEPSEEN_AUTH_BASE_URL: ${DEEPSEEN_AUTH_BASE_URL}
      JWT_SECRET: ${JWT_SECRET}
```

`.env.prod`：

```env
DATABASE_URL=postgresql://<deepseen_user>:<password>@<deepseen-postgres-host>:5432/<deepseen_db>
HERMES_DATABASE_URL=postgresql://<deepseen_user>:<password>@<deepseen-postgres-host>:5432/<deepseen_db>
DEEPSEEN_AUTH_BASE_URL=https://<deepseen-api-domain>
JWT_SECRET=<same-as-deepseen-jwt-secret>
```

如果 Herbound 和 DeepSeen 在同一台 Docker 网络中，推荐使用内部容器名访问 PostgreSQL，不通过公网暴露数据库。

## 验证用例

除 Herbound 自身验证外，必须执行 DeepSeen 原功能回归，确保新增表和新服务连接不会影响原项目。

### 登录验证

- 使用 DeepSeen 已有用户登录 Herbound。
- 使用错误密码登录失败。
- 被封禁用户登录失败。
- DeepSeen 强制下线后，Herbound token 失效。

### Skill 隔离验证

- 用户 A 对话沉淀 skill。
- 用户 A 再次对话能加载该 skill。
- 用户 B 登录后不能加载用户 A 的个人 skill。
- 同部门用户能加载部门公开 skill。
- 不同部门用户不能加载部门限定 skill。

### 迁移验证

- 迁移前后 skill_definitions 数量一致。
- 迁移前后 skill_versions 数量一致。
- 所有 `created_by`、`owner_user_id`、`user_id` 均能在 DeepSeen `"User"` 找到。
- 不存在孤儿 skill assignment。

### 回归验证

- Herbound Web 对话能连上 `/api/ws`。
- 桌面端登录后不跳回登录页。
- deepseen 工具调用正常。
- 工具返回结果仍按用户友好格式展示。
- skill 总结仍同时写本地和数据库。
- DeepSeen Web 登录/注册仍正常。
- DeepSeen 用户中心、积分余额、任务列表、支付订单、OpenAPI Key、工作流、Admin 用户列表仍正常。
- DeepSeen Prisma migration 状态正常，不出现 drift。

## 风险点

### User 表名大小写

Prisma `model User` 在 PostgreSQL 中通常是真实表名 `"User"`，需要双引号。

Herbound Python SQL 访问时必须写：

```sql
SELECT * FROM "User" WHERE id = ?
```

不能写：

```sql
SELECT * FROM user
SELECT * FROM users
```

### JWT_SECRET 必须一致

如果 Herbound 要直接校验 DeepSeen accessToken，两个服务必须使用同一个 `JWT_SECRET`。

### Access Token 有效期

DeepSeen 生产默认 access token 可能是 15 分钟，Herbound 桌面端需要处理刷新 token，否则用户会频繁掉线。

第一版可先保持 Herbound 使用 DeepSeen access token。第二版应接入 DeepSeen refresh token。

### 表名冲突

Herbound 原表 `teams` 与 DeepSeen `Team` 概念冲突，因此迁移到 `herbound_departments`。

### 用户 ID 类型

DeepSeen `User.id` 是 `String cuid`，Herbound 旧用户可能是数字 ID 或 username。迁移时必须做映射，不能直接硬塞。

### 本地 skill 文件和数据库一致性

Herbound 仍需要保留本地 runtime skill 文件，用于实际提示词加载。数据库是权威存储，本地目录是运行时物化缓存。

建议策略：

```text
数据库写入成功 -> 物化本地 runtime skill
本地写入失败 -> 标记 runtime snapshot 异常
数据库失败 -> 不允许只写本地成功
```

## 回滚方案

1. Herbound `.env.prod` 改回原 Herbound PostgreSQL。
2. 恢复旧 Herbound auth 逻辑。
3. DeepSeen 主库中保留 `herbound_*` 表，不删除。
4. 如需彻底回滚，使用上线前 `pg_dump` 恢复。

## 建议实施顺序

1. 在 DeepSeen PostgreSQL 建 `herbound_*` 表。
2. Herbound 增加 DeepSeen JWT 校验模块。
3. Herbound `/api/auth/me`、`/api/auth/ws-ticket` 使用 DeepSeen token。
4. Herbound 所有 current_user.id 改为 DeepSeen `"User".id`。
5. Herbound enterprise skill db 表名加 `herbound_` 前缀。
6. 编写迁移脚本，将旧 Herbound 表导入 DeepSeen。
7. 本地验证用户 A/B skill 隔离。
8. Docker 生产部署改为连接 DeepSeen 数据库。
9. 上线后观察登录、对话、skill 总结、skill 加载和 deepseen 工具调用。

## 本地验证记录

验证日期：2026-06-23

本地只启动 DeepSeen 数据库：

```bash
cd D:\Users\Administrator\Desktop\deepseen
docker compose up -d postgres
```

当前本地 PostgreSQL：

```text
容器：viralforge-postgres
数据库：viralforge
用户：postgres
密码：postgres
端口：5433 -> 5432
```

本地建表 SQL：

```text
D:\Users\Administrator\Desktop\deepseen\scripts\deploy\create-herbound-tables.sql
```

执行方式：

```powershell
Get-Content -Raw scripts\deploy\create-herbound-tables.sql |
  docker exec -i viralforge-postgres psql -v ON_ERROR_STOP=1 -U postgres -d viralforge
```

本地验证结果：

```text
DeepSeen 原表数量：46
新增 Herbound 表数量：22
Herbound 表全部使用 herbound_ 前缀
外键只引用 DeepSeen "User"(id) 和 herbound_* 表
未启动 Herbound/Hermes 独立数据库
```

已创建并验证的本地测试链路：

```text
"User"
  -> herbound_organizations
  -> herbound_departments
  -> herbound_employee_profiles
  -> herbound_user_department_memberships
  -> herbound_skill_definitions
  -> herbound_skill_versions
  -> herbound_employee_skill_assignments
  -> herbound_sessions
  -> herbound_messages
```

测试数据仅写入 `herbound_*` 表，没有写入 DeepSeen 现有业务表。

## 最终状态

上线完成后：

```text
DeepSeen 是唯一用户中心。
DeepSeen PostgreSQL 是唯一生产数据库。
Herbound 不再使用自己的 users 表作为身份来源。
Herbound 专属数据全部在 DeepSeen 数据库的 herbound_* 表中。
Herbound 桌面端、Web 端均用 DeepSeen 用户登录。
用户 skill 按企业、部门、员工和个人维度隔离加载。
```
