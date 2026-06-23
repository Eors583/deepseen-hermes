# Skill 存储位置测试记录

测试时间：2026-06-22  
测试方式：代码路径核查 + 隔离 `HERMES_HOME` 调用 `skill_manage(action="create")` 实测。

## 结论

用户和 Herbound 多轮对话后，如果后台 self-improvement review 判断需要创建或更新 skill，最终会通过 `skill_manage` 工具写入 skill。

主存储位置是当前 Hermes Profile 的本地文件系统：

```text
<HERMES_HOME>/skills/<category>/<skill-name>/SKILL.md
```

当前本机默认 `HERMES_HOME` 为：

```text
C:\Users\Administrator\AppData\Local\hermes
```

因此默认 profile 下，agent 生成的新 skill 会落在：

```text
C:\Users\Administrator\AppData\Local\hermes\skills\<category>\<skill-name>\SKILL.md
```

如果当前进程设置了 profile 专属 `HERMES_HOME`，则会写入该 profile 的：

```text
<profile-HERMES_HOME>\skills\...
```

如果设置了 `HERMES_RUNTIME_SKILLS_DIR`，`get_skills_dir()` 会优先返回该 runtime skills 目录，skill 会写到 runtime skills 目录。

## 数据库同步

当前代码在本地文件写入成功后，会尝试同步到企业技能数据库：

```text
enterprise_db_sync = _sync_skill_to_enterprise_db(...)
```

企业技能数据库当前依赖 PostgreSQL，必须设置以下任一环境变量：

```text
HERMES_DATABASE_URL
DATABASE_URL
POSTGRES_URL
POSTGRESQL_URL
```

本机当前没有配置这些数据库环境变量，因此实测结果是：

- 本地 `SKILL.md` 创建成功。
- `enterprise_db_sync.synced = false`。
- 错误信息：`PostgreSQL is required for the Herbound FastAPI backend...`。

## 隔离实测结果

临时 `HERMES_HOME`：

```text
C:\Users\ADMINI~1\AppData\Local\Temp\hermes-skill-storage-test-7uq80qeb
```

创建的测试 skill：

```text
C:\Users\ADMINI~1\AppData\Local\Temp\hermes-skill-storage-test-7uq80qeb\skills\qa-test\codex-storage-test\SKILL.md
```

结果：

```json
{
  "success": true,
  "path": "qa-test\\codex-storage-test",
  "skill_file_exists": true,
  "enterprise_db_sync": {
    "synced": false,
    "error": "PostgreSQL is required for the Herbound FastAPI backend. Set one of: HERMES_DATABASE_URL, DATABASE_URL, POSTGRES_URL, POSTGRESQL_URL"
  }
}
```

## 相关代码位置

- `tools/skill_manager_tool.py`：`skill_manage()` 负责 create/edit/patch/delete/write_file/remove_file。
- `tools/skill_manager_tool.py`：`_create_skill()` 将 `SKILL.md` 写入 `get_skills_dir()` 下。
- `hermes_constants.py`：`get_skills_dir()` 默认返回 `get_hermes_home() / "skills"`，但会优先使用 `HERMES_RUNTIME_SKILLS_DIR`。
- `agent/background_review.py`：多轮对话后的后台 review 会调用 memory/skill management tools 保存学习结果。
- `hermes_cli/enterprise_skills/db.py` + `hermes_cli/postgres_store.py`：企业技能库同步依赖 PostgreSQL。

## QA 判断

当前实现是“本地 skill 文件为主，企业 DB 为同步镜像”。如果产品预期是“所有对话形成的 skill 必须同时进数据库”，则当前环境缺 PostgreSQL URL 时不满足该预期；但如果产品预期是“本地可用优先，数据库有配置时再同步”，当前行为符合代码设计。

## 数据库实查补充

复查时间：2026-06-22  
数据库容器：`deepseen-hermes-postgres`  
数据库：`hermes`  
连接方式：`docker exec deepseen-hermes-postgres psql -U hermes -d hermes`

### 表结构状态

企业技能相关表已存在，包括：

```text
skill_definitions
skill_versions
skill_files
skill_usage_events
skill_visibility_rules
skill_audit_logs
skill_feedback
skill_proposals
skill_runtime_snapshots
```

### 当前数据量

```text
skill_definitions: 3
skill_versions: 3
skill_files: 1
skill_usage_events: 0
```

### 当前数据库中已有 skill

| name | display_name | status | version_status |
| --- | --- | --- | --- |
| enterprise-smoke-skill | enterprise-smoke-skill | draft | draft |
| codex-gap-smoke | codex-gap-smoke | published | published |
| crossborder-deepseen | 跨境 DeepSeen 工具规范 | published | published |

### 是否存入刚才测试生成的 skill

没有。

本轮隔离测试创建的：

```text
codex-storage-test
```

没有出现在 `skill_definitions` 表中。

原因：隔离测试进程没有配置 PostgreSQL 连接环境变量，`enterprise_db_sync` 返回失败；本地 `SKILL.md` 创建成功，但没有同步进数据库。

### QA 判断

- 数据库企业技能表是存在的，并且已有 3 条历史/烟测技能数据。
- 当前默认本地 `HERMES_HOME` 的 `.env` 里没有数据库连接变量，只有 `DEEPSEEN_API_KEY`。
- 如果桌面端或 Web 后端进程没有继承 `HERMES_DATABASE_URL` / `DATABASE_URL`，对话沉淀出的 skill 只会落本地文件，不会进企业技能数据库。
- 如果产品要求“用户多轮对话形成的 skill 必须进入数据库”，需要确保运行 Herbound 的后端进程实际带有 PostgreSQL 连接环境变量，并对 `enterprise_db_sync.synced=true` 做告警或失败处理。
