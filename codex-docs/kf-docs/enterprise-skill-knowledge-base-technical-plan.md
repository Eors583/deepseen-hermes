# Herbound 企业级 Skill 知识库技术实现方案

日期：2026-06-18  
适用项目：`hermes-agent-main` / Herbound  
依据文档：`codex-docs/cp-docs/enterprise-skill-knowledge-base-design.md`

## 1. 实现目标

本方案用于把当前 Hermes 本地文件型 Skill 机制升级为 Herbound 企业级 Skill 知识库。

技术目标：

- Skill 主数据进入数据库，文件系统只作为 Hermes 运行时兼容缓存。
- Skill 跟随企业、团队、角色、用户和 profile，而不是跟随单机本地目录。
- 支持版本、审核、发布、回滚、归档、权限、审计和使用统计。
- 保持 Hermes 原有 `SKILL.md`、`skill_view`、`skills_list`、slash command、prompt builder 的短期兼容。
- 不破坏 Hermes 会话级 prompt cache：会话创建时冻结 Skill snapshot。
- 智能体可生成 Skill 草稿，但不能直接污染生产知识库。
- 为后续 Obsidian、Dify、企业 SOP、字段展示规则、DeepSeen 工具 schema 数据库化预留扩展。

## 2. 当前代码落点

当前项目相关模块：

| 模块 | 当前职责 | 改造策略 |
| --- | --- | --- |
| `tools/skills_tool.py` | 扫描本地 Skill 并提供 `skills_list` / `skill_view` | MVP 先不大改，通过运行时目录兼容 |
| `tools/skill_manager_tool.py` | 本地创建、编辑、删除 Skill | 生产环境改为 proposal，不直写 published |
| `agent/prompt_builder.py` | 构建 Skills index，影响系统 prompt | 通过会话 snapshot 固定 Skill 集合 |
| `agent/skill_commands.py` | 扫描 Skill 生成 slash command | 从 materialized runtime dir 读取 |
| `hermes_cli/web_server.py` | 当前 `/api/skills` 本地文件接口 | 保留兼容，新增企业 Skill API |
| `hermes_cli/dashboard_auth` | Web 登录、用户、角色 | 复用当前用户体系，补企业/团队/RBAC |
| `hermes-web-ui` | Web 管理和聊天界面 | 新增企业技能库、审核中心、员工技能页 |

MVP 不直接重构 Hermes 内核。先做：

```text
数据库主数据
  -> 会话级 Skill snapshot
  -> materialize 到 runtime skill 目录
  -> Hermes 原生本地 Skill 读取机制
```

## 3. 总体架构

```mermaid
flowchart TD
    A["Web UI: 管理员/员工"] --> B["FastAPI 后端"]
    B --> C["Enterprise Skill Service"]
    B --> D["Skill Governance Service"]
    B --> E["Skill Runtime Adapter"]
    C --> F["PostgreSQL / SQLite 兼容数据库"]
    C --> G["对象存储: OSS/S3/本地 volume"]
    E --> H["runtime skill snapshot 目录"]
    H --> I["Hermes 原生 Skill 扫描"]
    I --> J["Agent prompt_builder / skill_view / slash command"]
    J --> K["Herbound 智能体"]
    K --> L["DeepSeen 工具 / 业务工具"]
```

核心原则：

- 数据库是唯一主数据。
- runtime 文件目录是可重建缓存。
- 会话启动时冻结 Skill 版本。
- 新发布 Skill 默认只影响新会话。
- 当前会话需要显式刷新才更新 Skill snapshot。

## 4. 后端模块设计

建议新增包：

```text
hermes_cli/
  enterprise_skills/
    __init__.py
    db.py
    models.py
    schemas.py
    service.py
    runtime_adapter.py
    governance.py
    proposals.py
    routes.py
    permissions.py
    materializer.py
    migrations/
```

### 4.1 `db.py`

职责：

- 管理企业 Skill 数据库连接。
- 支持 SQLite 开发环境与 PostgreSQL 生产环境。
- 提供事务上下文。
- 初始化迁移。

建议：

- MVP 可以沿用项目现有 SQLite 部署习惯，表结构使用兼容 SQL。
- 生产建议 PostgreSQL，因为后续需要 JSONB、全文搜索、并发写入、审计和租户隔离。

配置建议：

```yaml
enterprise_skills:
  enabled: true
  database_url: sqlite:///hermes_data/enterprise_skills.db
  runtime_root: hermes_data/runtime-skills
  object_storage: local
```

生产 PostgreSQL：

```yaml
enterprise_skills:
  enabled: true
  database_url: postgresql+psycopg://herbound:***@postgres:5432/herbound
  runtime_root: /app/hermes_data/runtime-skills
  object_storage: s3
```

### 4.2 `models.py`

定义 ORM 模型：

- Organization
- Team
- TeamMembership
- SkillDefinition
- SkillVersion
- SkillFile
- SkillVisibilityRule
- SkillRuntimeSnapshot
- SkillUsageEvent
- SkillFeedback
- SkillProposal
- SkillAuditLog
- EnterpriseProfileBinding
- ToolPolicy
- OutputSchema
- FieldTranslation

### 4.3 `service.py`

`EnterpriseSkillService`。

职责：

- 创建 Skill。
- 更新草稿。
- 提交审核。
- 审核通过/拒绝。
- 发布版本。
- 回滚版本。
- 归档 Skill。
- 计算用户可用 Skill。
- 获取 Skill 内容。
- 写入使用事件。

核心接口：

```python
class EnterpriseSkillService:
    def list_skills(self, context, filters): ...
    def get_skill(self, context, skill_id): ...
    def create_skill(self, context, payload): ...
    def update_draft(self, context, skill_id, payload): ...
    def submit_review(self, context, skill_id, version_id): ...
    def approve_version(self, context, skill_id, version_id, comment): ...
    def publish_version(self, context, skill_id, version_id): ...
    def rollback(self, context, skill_id, target_version_id): ...
    def archive_skill(self, context, skill_id): ...
    def compute_available_skills(self, context): ...
```

### 4.4 `runtime_adapter.py`

`SkillRuntimeAdapter`。

职责：

- 根据 `organization_id + user_id + profile_id + session_id` 创建 Skill snapshot。
- 将数据库中的 Skill materialize 为 Hermes 可读取目录。
- 返回 runtime `SKILLS_DIR`。
- 保证同一个 session 使用同一个 snapshot。

运行时目录：

```text
hermes_data/runtime-skills/
  org_<org_id>/
    snapshots/
      <snapshot_hash>/
        skills/
          crossborder-deepseen/
            SKILL.md
            references/
            templates/
            scripts/
            assets/
```

注意：

- 目录内容由数据库生成。
- 不允许用户直接上传任意路径。
- snapshot hash 由 `skill_id + version_id + content_hash + permission_hash` 计算。
- 可以定期清理 30 天未使用 snapshot。

### 4.5 `materializer.py`

职责：

- 从 `skill_versions.content_md` 生成 `SKILL.md`。
- 从 `skill_files` 生成 references/templates/scripts/assets。
- 校验 path，禁止 `../`、绝对路径、Windows drive path。
- 文本文件写入本地 runtime cache。
- 大文件下载或链接到对象存储。

### 4.6 `governance.py`

`SkillGovernanceService`。

职责：

- 校验 Skill 名称和 frontmatter。
- 检测 prompt 注入。
- 检测密钥泄露。
- 检测危险脚本。
- 检测越权工具调用。
- 生成审核报告。

MVP 扫描规则：

| 风险 | 检测 |
| --- | --- |
| Prompt 注入 | `ignore previous instructions`、`system prompt`、`developer message` 等 |
| 密钥泄露 | `sk-`、`api_key`、`SECRET`、`TOKEN`、`PASSWORD` |
| 文件越权 | `~/.hermes`、`C:\Users`、`/root`、`/etc` |
| 危险脚本 | `rm -rf`、`curl | sh`、`Invoke-Expression` |
| 越权工具 | 未绑定工具却要求调用敏感工具 |

### 4.7 `proposals.py`

职责：

- 接收智能体沉淀草稿。
- 关联来源会话。
- 自动推荐分类、团队和负责人。
- 创建 `skill_proposals`。
- 管理员可一键转为 `skill_definitions + skill_versions` 草稿。

## 5. 数据库设计

以下 DDL 以 PostgreSQL 为主，SQLite MVP 可将 `uuid` 改为 `text`，`jsonb` 改为 `text/json`，`timestamptz` 改为 `datetime/text`。

### 5.1 基础租户与组织

```sql
create table organizations (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table teams (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  parent_id uuid references teams(id) on delete set null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_teams_org on teams(organization_id);

create table user_organization_memberships (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id text not null,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index idx_user_org_memberships_user on user_organization_memberships(user_id);
create index idx_user_org_memberships_org_role on user_organization_memberships(organization_id, role);

create table user_team_memberships (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  user_id text not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create index idx_user_team_memberships_org_user on user_team_memberships(organization_id, user_id);
```

说明：

- 当前项目用户 ID 可能是 int，本方案用 `text` 存储兼容 int/uuid。
- 后续如果重构用户表，可迁移为 uuid。

### 5.2 Skill 主表

```sql
create table skill_definitions (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  display_name text not null,
  description text,
  category text,
  business_domain text,
  status text not null default 'draft',
  latest_version_id uuid,
  published_version_id uuid,
  owner_user_id text,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, name)
);

create index idx_skill_definitions_org_status on skill_definitions(organization_id, status);
create index idx_skill_definitions_org_category on skill_definitions(organization_id, category);
create index idx_skill_definitions_owner on skill_definitions(organization_id, owner_user_id);
```

状态枚举：

```text
draft | review | published | archived
```

命名规则：

- `name` 兼容 Hermes Skill 文件夹名。
- 只允许小写字母、数字、短横线、下划线。
- 不允许空格和路径分隔符。

### 5.3 Skill 版本

```sql
create table skill_versions (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  skill_id uuid not null references skill_definitions(id) on delete cascade,
  version int not null,
  semver text,
  content_md text not null,
  frontmatter_json jsonb not null default '{}'::jsonb,
  references_json jsonb not null default '[]'::jsonb,
  templates_json jsonb not null default '[]'::jsonb,
  assets_json jsonb not null default '[]'::jsonb,
  tools_json jsonb not null default '[]'::jsonb,
  output_rules_json jsonb not null default '{}'::jsonb,
  changelog text,
  status text not null default 'draft',
  content_sha256 text not null,
  created_by text not null,
  reviewed_by text,
  published_by text,
  reject_reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz,
  unique (skill_id, version)
);

create index idx_skill_versions_skill_status on skill_versions(skill_id, status);
create index idx_skill_versions_org_status on skill_versions(organization_id, status);
create index idx_skill_versions_sha on skill_versions(content_sha256);
```

状态枚举：

```text
draft | pending_review | approved | rejected | published | archived
```

### 5.4 Skill 支持文件

```sql
create table skill_files (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  skill_id uuid not null references skill_definitions(id) on delete cascade,
  skill_version_id uuid not null references skill_versions(id) on delete cascade,
  file_type text not null,
  path text not null,
  content_text text,
  object_url text,
  mime_type text,
  sha256 text not null,
  size_bytes bigint not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (skill_version_id, path)
);

create index idx_skill_files_version on skill_files(skill_version_id);
create index idx_skill_files_org_sha on skill_files(organization_id, sha256);
```

`file_type`：

```text
reference | template | script | asset
```

规则：

- `reference`、`template` 文本内容优先入库。
- `asset` 大文件入 OSS 或本地 volume，只存 `object_url`。
- `script` 默认只允许管理员审核后发布。

### 5.5 可见性与权限规则

```sql
create table skill_visibility_rules (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  skill_id uuid not null references skill_definitions(id) on delete cascade,
  scope_type text not null,
  scope_id text not null,
  access_level text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (skill_id, scope_type, scope_id, access_level)
);

create index idx_skill_visibility_org_scope on skill_visibility_rules(organization_id, scope_type, scope_id);
create index idx_skill_visibility_skill on skill_visibility_rules(skill_id);
```

`scope_type`：

```text
organization | team | user | role | profile
```

`access_level`：

```text
view | use | edit | approve | admin
```

### 5.6 会话级 Runtime Snapshot

```sql
create table skill_runtime_snapshots (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id text not null,
  session_id text not null,
  profile_id text,
  skill_ids_json jsonb not null default '[]'::jsonb,
  version_ids_json jsonb not null default '[]'::jsonb,
  snapshot_hash text not null,
  runtime_skills_dir text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (organization_id, session_id)
);

create index idx_skill_snapshots_org_user on skill_runtime_snapshots(organization_id, user_id);
create index idx_skill_snapshots_hash on skill_runtime_snapshots(snapshot_hash);
create index idx_skill_snapshots_last_used on skill_runtime_snapshots(last_used_at);
```

作用：

- 追踪某会话使用了哪些 Skill 版本。
- 支持复盘。
- 支持 prompt cache 稳定。
- 支持 runtime 目录清理。

### 5.7 使用事件

```sql
create table skill_usage_events (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id text not null,
  session_id text,
  profile_id text,
  skill_id uuid references skill_definitions(id) on delete set null,
  skill_version_id uuid references skill_versions(id) on delete set null,
  event_type text not null,
  tool_name text,
  request_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_skill_usage_org_created on skill_usage_events(organization_id, created_at);
create index idx_skill_usage_skill on skill_usage_events(skill_id, created_at);
create index idx_skill_usage_user on skill_usage_events(organization_id, user_id, created_at);
create index idx_skill_usage_session on skill_usage_events(session_id);
```

`event_type`：

```text
listed | viewed | injected | invoked | proposed | edited | reviewed | published | failed | feedback
```

### 5.8 用户反馈

```sql
create table skill_feedback (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  skill_id uuid not null references skill_definitions(id) on delete cascade,
  skill_version_id uuid references skill_versions(id) on delete set null,
  user_id text not null,
  session_id text,
  rating int,
  feedback_text text,
  created_at timestamptz not null default now()
);

create index idx_skill_feedback_skill on skill_feedback(skill_id, created_at);
create index idx_skill_feedback_org_user on skill_feedback(organization_id, user_id, created_at);
```

### 5.9 智能体沉淀草稿

```sql
create table skill_proposals (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  source_type text not null,
  source_session_id text,
  proposed_by text not null,
  title text not null,
  description text,
  suggested_name text,
  suggested_category text,
  suggested_scope_json jsonb not null default '{}'::jsonb,
  content_md text not null,
  source_summary text,
  status text not null default 'pending',
  converted_skill_id uuid references skill_definitions(id) on delete set null,
  converted_version_id uuid references skill_versions(id) on delete set null,
  reviewer_id text,
  review_comment text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index idx_skill_proposals_org_status on skill_proposals(organization_id, status);
create index idx_skill_proposals_source_session on skill_proposals(source_session_id);
```

`source_type`：

```text
agent | user | admin_import | migration
```

`status`：

```text
pending | accepted | rejected | converted | archived
```

### 5.10 审计日志

```sql
create table skill_audit_logs (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_user_id text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  before_json jsonb,
  after_json jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_skill_audit_org_created on skill_audit_logs(organization_id, created_at);
create index idx_skill_audit_target on skill_audit_logs(target_type, target_id);
```

### 5.11 工具策略与输出展示规则

产品方案要求“工具参数说明、字段展示规则、结果展示模板”逐步数据库化。建议从 DeepSeen 开始预留以下表。

```sql
create table tool_policies (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id text,
  tool_name text not null,
  enabled boolean not null default true,
  allowed_roles_json jsonb not null default '[]'::jsonb,
  allowed_teams_json jsonb not null default '[]'::jsonb,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, profile_id, tool_name)
);

create table output_schemas (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  tool_name text not null,
  schema_name text not null,
  version int not null,
  renderer text not null default 'markdown',
  visible_fields_json jsonb not null default '[]'::jsonb,
  hidden_fields_json jsonb not null default '[]'::jsonb,
  field_order_json jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  created_by text not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (organization_id, tool_name, schema_name, version)
);

create table field_translations (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  schema_id uuid references output_schemas(id) on delete cascade,
  field_path text not null,
  display_label text not null,
  display_type text,
  value_map_json jsonb not null default '{}'::jsonb,
  hide_by_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schema_id, field_path)
);
```

用途：

- DeepSeen 返回字段不再写死在 `deepseen_runner.mjs`。
- 管理员可在后台调整字段展示名称。
- 未来不同企业可以有不同展示口径。
- Skill 可以绑定某个 output schema 版本。

## 6. API 设计

新增路由前缀：

```text
/api/enterprise
```

### 6.1 Skill 管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/enterprise/skills` | Skill 列表 |
| `POST` | `/api/enterprise/skills` | 创建 Skill 和初始草稿 |
| `GET` | `/api/enterprise/skills/{skill_id}` | Skill 详情 |
| `PATCH` | `/api/enterprise/skills/{skill_id}` | 更新 Skill 基础信息 |
| `DELETE` | `/api/enterprise/skills/{skill_id}` | 归档 Skill，不物理删除 |

### 6.2 版本与审核

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/enterprise/skills/{skill_id}/versions` | 版本列表 |
| `POST` | `/api/enterprise/skills/{skill_id}/versions` | 创建新草稿版本 |
| `PUT` | `/api/enterprise/skills/{skill_id}/draft` | 更新草稿内容 |
| `POST` | `/api/enterprise/skills/{skill_id}/submit-review` | 提交审核 |
| `POST` | `/api/enterprise/skills/{skill_id}/approve` | 审核通过 |
| `POST` | `/api/enterprise/skills/{skill_id}/reject` | 审核拒绝 |
| `POST` | `/api/enterprise/skills/{skill_id}/publish` | 发布版本 |
| `POST` | `/api/enterprise/skills/{skill_id}/rollback` | 回滚版本 |

### 6.3 权限与可见性

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/enterprise/skills/{skill_id}/visibility` | 获取可见性规则 |
| `PUT` | `/api/enterprise/skills/{skill_id}/visibility` | 更新可见性规则 |
| `GET` | `/api/enterprise/skills/available` | 当前用户可用 Skill |

### 6.4 Runtime Snapshot

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/enterprise/skills/runtime-snapshot` | 创建或复用会话 snapshot |
| `GET` | `/api/enterprise/skills/runtime-snapshot/{session_id}` | 获取会话 snapshot |
| `POST` | `/api/enterprise/skills/runtime-snapshot/{session_id}/refresh` | 显式刷新当前会话 Skill |

创建 snapshot 请求：

```json
{
  "session_id": "20260618_120000_abcd12",
  "profile_id": "herbound",
  "force_refresh": false
}
```

响应：

```json
{
  "snapshot_id": "uuid",
  "snapshot_hash": "sha256",
  "runtime_skills_dir": "hermes_data/runtime-skills/org_x/snapshots/hash/skills",
  "skill_count": 8,
  "versions": [
    {
      "skill_id": "uuid",
      "version_id": "uuid",
      "name": "crossborder-deepseen",
      "version": 3
    }
  ]
}
```

### 6.5 Proposal 与沉淀

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/enterprise/skills/proposals` | 草稿沉淀池 |
| `POST` | `/api/enterprise/skills/proposals` | 智能体/用户提交草稿 |
| `POST` | `/api/enterprise/skills/proposals/{proposal_id}/accept` | 接受并转为 Skill 草稿 |
| `POST` | `/api/enterprise/skills/proposals/{proposal_id}/reject` | 拒绝 |

### 6.6 统计与反馈

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/enterprise/skills/{skill_id}/usage` | 使用统计 |
| `POST` | `/api/enterprise/skills/{skill_id}/feedback` | 反馈 |
| `GET` | `/api/enterprise/skills/audit-logs` | 审计日志 |

## 7. 与 Hermes 原生 Skill 的兼容方案

### 7.1 会话创建流程

```mermaid
sequenceDiagram
    participant UI as Web UI
    participant API as FastAPI
    participant ESS as EnterpriseSkillService
    participant RA as RuntimeAdapter
    participant DB as DB
    participant H as Hermes Agent

    UI->>API: 创建会话
    API->>ESS: 计算用户可用 Skill
    ESS->>DB: 查询 published skill + 权限
    API->>RA: create_runtime_snapshot(session_id)
    RA->>DB: 写入 skill_runtime_snapshots
    RA->>RA: materialize SKILL.md 到 runtime dir
    API->>H: 启动 Agent，绑定 runtime SKILLS_DIR
    H->>H: 原生 prompt_builder 扫描 Skill
```

### 7.2 如何让 Hermes 读取 runtime dir

MVP 推荐做法：

- 在启动会话对应的 Agent/Gateway 子进程时注入环境变量：

```text
HERMES_RUNTIME_SKILLS_DIR=<runtime_skills_dir>
```

- 修改 `tools/skills_tool.py`、`agent/skill_commands.py`、`agent/prompt_builder.py` 的 Skill 根目录解析逻辑：

```python
def get_active_skills_dir() -> Path:
    runtime = os.environ.get("HERMES_RUNTIME_SKILLS_DIR")
    if runtime:
        return Path(runtime)
    return get_hermes_home() / "skills"
```

如果短期不想改多处代码，可以在 profile 级 Hermes home 下创建：

```text
<profile_home>/skills -> runtime snapshot skills dir
```

但软链接方案在 Windows/Docker/权限上容易出问题，推荐显式 runtime dir。

### 7.3 `skill_manage` 改造

生产环境规则：

| 场景 | 行为 |
| --- | --- |
| 用户创建个人草稿 | 写入 `skill_proposals` 或个人 draft |
| 用户编辑企业 Skill | 创建 patch proposal |
| 管理员编辑 draft | 更新 `skill_versions` draft |
| Published Skill | 不能直接覆盖，只能创建新版本 |
| 删除 Skill | 归档 proposal 或管理员归档 |

建议新增配置：

```yaml
enterprise_skills:
  skill_manage_mode: proposal_only
```

## 8. 前端实现方案

新增页面：

```text
hermes-web-ui/packages/client/src/views/hermes/EnterpriseSkillsView.vue
hermes-web-ui/packages/client/src/views/hermes/EnterpriseSkillDetailView.vue
hermes-web-ui/packages/client/src/views/hermes/SkillReviewView.vue
hermes-web-ui/packages/client/src/views/hermes/SkillProposalView.vue
```

新增 API：

```text
hermes-web-ui/packages/client/src/api/hermes/enterpriseSkills.ts
```

### 8.1 管理员技能库

路径：

```text
/hermes/enterprise-skills
```

功能：

- 列表筛选：状态、分类、团队、负责人、关键词。
- 新建 Skill。
- 查看详情。
- 编辑草稿。
- 提交审核。
- 发布。
- 回滚。
- 归档。

### 8.2 Skill 详情

模块：

- 基础信息。
- 当前生产版本。
- 草稿版本。
- Markdown 内容预览。
- 支持文件。
- 绑定工具。
- 权限范围。
- 版本记录。
- 使用统计。
- 用户反馈。

### 8.3 审核中心

路径：

```text
/hermes/skill-review
```

功能：

- 待审核 Skill。
- 智能体沉淀 proposal。
- Diff 对比。
- 风险扫描结果。
- 来源会话。
- 审核通过/拒绝。

### 8.4 员工技能页

路径：

```text
/hermes/skills
```

普通员工看到业务能力，不看 `SKILL.md` 原文：

- 能做什么。
- 需要提供什么。
- 输出什么。
- 示例问题。
- 适用团队。
- 当前版本。

## 9. 权限设计

角色：

```text
super_admin
org_admin
skill_admin
skill_reviewer
team_admin
member
```

权限判断统一放在 `permissions.py`：

```python
def can_view_skill(user, skill): ...
def can_use_skill(user, skill): ...
def can_edit_skill(user, skill): ...
def can_review_skill(user, skill): ...
def can_publish_skill(user, skill): ...
def can_manage_visibility(user, skill): ...
```

所有 API 必须带租户过滤：

```python
where skill.organization_id == current_context.organization_id
```

禁止：

- 前端传 organization_id 后端直接信任。
- runtime adapter 不带 organization_id 读取 Skill。
- 后台清理任务跨企业扫描但不校验路径前缀。

## 10. 迁移方案

### 10.1 平台基础 Skill 导入

导入当前：

```text
skills/crossborder-deepseen/SKILL.md
deploy/herbound/skills/crossborder-deepseen/SKILL.md
```

生成：

- organization：平台系统组织或默认企业。
- skill name：`crossborder-deepseen`
- status：published
- scope：organization / platform default

### 10.2 本地 Skill 导入

导入流程：

1. 扫描本地 `skills/`。
2. 解析 frontmatter。
3. 校验名称和内容。
4. 写入 `skill_proposals`。
5. 管理员选择发布到企业/团队/个人。

### 10.3 `/api/skills` 兼容

短期：

- `/api/skills` 继续保留本地兼容语义。
- 新功能走 `/api/enterprise/skills`。

中期：

- `/api/skills` 根据当前用户返回 enterprise available skills。
- 本地文件仅开发模式可见。

长期：

- 生产环境禁用本地 Skill 直写。
- 所有变更走企业审核流。

## 11. 开发阶段拆分

### Phase 1：数据库与基础 API

交付：

- 数据表迁移。
- `EnterpriseSkillService`。
- Skill CRUD。
- 版本 CRUD。
- 可见性规则。
- 审核发布回滚。
- 基础审计日志。

验收：

- 管理员能创建、编辑、发布 Skill。
- 普通用户只能看到有权限的 Skill。
- 不同企业数据隔离。

### Phase 2：Runtime Adapter 与 Hermes 兼容

交付：

- `SkillRuntimeAdapter`。
- `materializer`。
- 会话创建时生成 snapshot。
- Agent 启动读取 runtime skills dir。
- `skill_view` / `skills_list` 可读取企业 Skill。

验收：

- 发布企业 Skill 后，新会话可以加载。
- 老会话不受新版本影响。
- 删除 runtime cache 后可重建。

### Phase 3：前端管理后台

交付：

- 企业技能库页面。
- Skill 详情页。
- 审核中心。
- 权限范围配置。
- 版本 diff。

验收：

- 管理员可以完整走创建、审核、发布、回滚。
- 普通员工只看到员工视图。

### Phase 4：智能体自沉淀

交付：

- Agent proposal API。
- 草稿沉淀池。
- 来源会话关联。
- 安全扫描。

验收：

- 智能体只能生成 proposal。
- proposal 不能直接进入 published。
- 管理员审核后才生效。

### Phase 5：输出规则与工具策略数据库化

交付：

- `tool_policies`。
- `output_schemas`。
- `field_translations`。
- DeepSeen 字段展示规则迁移。

验收：

- DeepSeen 输出字段可在后台配置中文名、隐藏规则、值映射。
- 不再长期依赖代码硬编码字段翻译。

## 12. MVP 实施优先级

建议最小可行版本只做以下内容：

1. 表结构：organization、membership、skill_definitions、skill_versions、skill_files、visibility、runtime_snapshot。
2. API：创建、编辑、发布、available、runtime-snapshot。
3. Runtime：数据库 Skill materialize 到目录。
4. 会话：新会话绑定 runtime skills dir。
5. 前端：管理员列表、详情、发布；员工技能列表。
6. 生产限制：`skill_manage` 改 proposal only。

MVP 不做：

- 复杂审批流。
- 多级部门继承。
- 全文检索。
- 可视化 SOP 编排。
- Obsidian 双向同步。
- Dify 深度融合。

## 13. Obsidian 与 Dify 预留设计

### 13.1 Obsidian

定位：

- Obsidian 是企业知识素材来源之一，不是生产主数据。
- Obsidian Markdown 可导入成 Skill reference、SOP、案例库。

建议表扩展：

```sql
create table knowledge_sources (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  source_type text not null,
  name text not null,
  config_json jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table knowledge_documents (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  source_id uuid references knowledge_sources(id) on delete set null,
  title text not null,
  path text,
  content_md text,
  content_sha256 text not null,
  tags_json jsonb not null default '[]'::jsonb,
  linked_skill_id uuid references skill_definitions(id) on delete set null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 13.2 Dify

定位：

- Dify 可作为外部知识检索/RAG 工作流。
- Herbound 的 Skill 知识库仍负责业务流程、工具调用规则、权限、版本、审核。
- Dify dataset 可以绑定到 Skill 或团队。

建议扩展：

```sql
create table external_knowledge_bindings (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null,
  external_dataset_id text not null,
  skill_id uuid references skill_definitions(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  config_json jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
```

调用策略：

- Skill 负责告诉智能体什么时候查知识库。
- 工具层负责调用 Dify dataset/workflow。
- 返回结果经过 Herbound 输出规则渲染后再给用户。

## 14. 安全与运维

### 14.1 Runtime 目录安全

- 路径必须在 `runtime_root` 下。
- materializer 写入前 resolve 绝对路径并校验前缀。
- 禁止 `../`、绝对路径、盘符路径。
- runtime cache 可以删除重建。

### 14.2 数据备份

需要备份：

- 企业 Skill 数据库。
- 对象存储文件。
- runtime cache 不需要备份。

### 14.3 审计

所有写操作记录：

- actor。
- action。
- target。
- before/after。
- IP。
- User-Agent。
- 时间。

### 14.4 清理任务

定时清理：

- 30 天未使用 runtime snapshot。
- 已归档 180 天且无引用的 proposal 附件。
- 审计日志按企业策略归档，不默认删除。

## 15. 风险与解决方案

| 风险 | 说明 | 解决 |
| --- | --- | --- |
| Prompt cache 失效 | 会话中 Skill 动态变化 | 会话级 snapshot，新版本只影响新会话 |
| 权限绕过 | 用户直接访问 runtime dir 或旧 `/api/skills` | API 租户过滤，生产禁用本地直写 |
| 数据库与文件不一致 | 文件和 DB 都被当主数据 | DB 是唯一主数据，runtime 可重建 |
| 多租户泄露 | 跨企业读取 Skill | 所有表带 organization_id，所有查询强制过滤 |
| Agent 污染知识库 | 智能体直接写 published | Agent 只能写 proposal |
| 大文件膨胀 DB | assets 入库过大 | 大文件进对象存储 |
| 字段展示规则散落代码 | DeepSeen 输出规则难维护 | Phase 5 迁移到 output schema |

## 16. 结论

推荐技术路线：

1. 先做数据库主数据和企业 Skill API。
2. 通过 runtime materialize 目录兼容 Hermes 原生 Skill。
3. 会话创建时冻结 Skill snapshot，保护 prompt cache。
4. 生产环境禁止本地 Skill 直写，所有企业 Skill 走审核发布。
5. 后续逐步把工具策略、输出 schema、字段翻译、SOP、Obsidian 文档、Dify dataset 绑定纳入同一套企业能力资产系统。

这条路径改动可控，能最快上线企业 Skill 知识库，同时不会打断 Hermes 当前核心运行链路。
