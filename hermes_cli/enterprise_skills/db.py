from __future__ import annotations

import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from hermes_constants import get_hermes_home
from hermes_cli import postgres_store


def now_ms() -> int:
    return int(time.time() * 1000)


def runtime_root() -> Path:
    path = get_hermes_home() / "runtime-skills"
    path.mkdir(parents=True, exist_ok=True)
    return path


def connect() -> Any:
    conn = postgres_store.connect()
    init_db(conn)
    return conn


@contextmanager
def transaction() -> Iterator[Any]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(conn: Any) -> None:
    _init_db_postgres(conn)


def _init_db_postgres(conn: Any) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS organizations (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'active',
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS teams (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            name TEXT NOT NULL,
            parent_id TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY(parent_id) REFERENCES teams(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(organization_id);

        CREATE TABLE IF NOT EXISTS user_organization_memberships (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            status TEXT NOT NULL DEFAULT 'active',
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            UNIQUE(organization_id, user_id),
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_user_org_memberships_user ON user_organization_memberships(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_org_memberships_org_role ON user_organization_memberships(organization_id, role);

        CREATE TABLE IF NOT EXISTS user_team_memberships (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            team_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            created_at BIGINT NOT NULL,
            UNIQUE(team_id, user_id),
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_user_team_memberships_org_user ON user_team_memberships(organization_id, user_id);

        CREATE TABLE IF NOT EXISTS employee_profiles (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            employee_no TEXT,
            display_name TEXT NOT NULL,
            title TEXT,
            phone TEXT,
            email TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            UNIQUE(organization_id, user_id),
            UNIQUE(organization_id, employee_no),
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_employee_profiles_org_status ON employee_profiles(organization_id, status);
        CREATE INDEX IF NOT EXISTS idx_employee_profiles_user ON employee_profiles(user_id);

        CREATE TABLE IF NOT EXISTS skill_definitions (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            description TEXT,
            category TEXT,
            business_domain TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            latest_version_id TEXT,
            published_version_id TEXT,
            owner_user_id TEXT,
            created_by TEXT NOT NULL,
            updated_by TEXT,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            archived_at BIGINT,
            UNIQUE(organization_id, name),
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_skill_definitions_org_status ON skill_definitions(organization_id, status);
        CREATE INDEX IF NOT EXISTS idx_skill_definitions_org_category ON skill_definitions(organization_id, category);

        CREATE TABLE IF NOT EXISTS skill_versions (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            semver TEXT,
            content_md TEXT NOT NULL,
            frontmatter_json TEXT NOT NULL DEFAULT '{}',
            references_json TEXT NOT NULL DEFAULT '[]',
            templates_json TEXT NOT NULL DEFAULT '[]',
            assets_json TEXT NOT NULL DEFAULT '[]',
            tools_json TEXT NOT NULL DEFAULT '[]',
            output_rules_json TEXT NOT NULL DEFAULT '{}',
            changelog TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            content_sha256 TEXT NOT NULL,
            created_by TEXT NOT NULL,
            reviewed_by TEXT,
            published_by TEXT,
            reject_reason TEXT,
            created_at BIGINT NOT NULL,
            reviewed_at BIGINT,
            published_at BIGINT,
            UNIQUE(skill_id, version),
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_id) REFERENCES skill_definitions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_status ON skill_versions(skill_id, status);
        CREATE INDEX IF NOT EXISTS idx_skill_versions_org_status ON skill_versions(organization_id, status);

        CREATE TABLE IF NOT EXISTS skill_files (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            skill_version_id TEXT NOT NULL,
            file_type TEXT NOT NULL,
            file_kind TEXT,
            path TEXT NOT NULL,
            content_text TEXT,
            object_url TEXT,
            mime_type TEXT,
            sha256 TEXT NOT NULL,
            size_bytes BIGINT NOT NULL DEFAULT 0,
            created_by TEXT NOT NULL,
            created_at BIGINT NOT NULL,
            UNIQUE(skill_version_id, path),
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_id) REFERENCES skill_definitions(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_version_id) REFERENCES skill_versions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_skill_files_version ON skill_files(skill_version_id);

        CREATE TABLE IF NOT EXISTS skill_visibility_rules (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            scope_type TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            access_level TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at BIGINT NOT NULL,
            UNIQUE(skill_id, scope_type, scope_id, access_level),
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_id) REFERENCES skill_definitions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_skill_visibility_org_scope ON skill_visibility_rules(organization_id, scope_type, scope_id);
        CREATE INDEX IF NOT EXISTS idx_skill_visibility_skill ON skill_visibility_rules(skill_id);

        CREATE TABLE IF NOT EXISTS employee_skill_assignments (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            access_level TEXT NOT NULL DEFAULT 'use',
            assigned_by TEXT NOT NULL,
            created_at BIGINT NOT NULL,
            UNIQUE(organization_id, user_id, skill_id, access_level),
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_id) REFERENCES skill_definitions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_employee_skill_assignments_user ON employee_skill_assignments(organization_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_employee_skill_assignments_skill ON employee_skill_assignments(skill_id);

        CREATE TABLE IF NOT EXISTS skill_runtime_snapshots (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            profile_id TEXT,
            skill_ids_json TEXT NOT NULL DEFAULT '[]',
            version_ids_json TEXT NOT NULL DEFAULT '[]',
            snapshot_hash TEXT NOT NULL,
            runtime_skills_dir TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at BIGINT NOT NULL,
            last_used_at BIGINT NOT NULL,
            UNIQUE(organization_id, session_id),
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_skill_snapshots_org_user ON skill_runtime_snapshots(organization_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_skill_snapshots_hash ON skill_runtime_snapshots(snapshot_hash);

        CREATE TABLE IF NOT EXISTS skill_usage_events (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            session_id TEXT,
            profile_id TEXT,
            skill_id TEXT,
            skill_version_id TEXT,
            event_type TEXT NOT NULL,
            tool_name TEXT,
            request_id TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at BIGINT NOT NULL,
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_id) REFERENCES skill_definitions(id) ON DELETE SET NULL,
            FOREIGN KEY(skill_version_id) REFERENCES skill_versions(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_skill_usage_org_created ON skill_usage_events(organization_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_skill_usage_skill ON skill_usage_events(skill_id, created_at);

        CREATE TABLE IF NOT EXISTS skill_feedback (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            skill_version_id TEXT,
            user_id TEXT NOT NULL,
            session_id TEXT,
            rating INTEGER,
            feedback_text TEXT,
            comment TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            created_at BIGINT NOT NULL,
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_id) REFERENCES skill_definitions(id) ON DELETE CASCADE,
            FOREIGN KEY(skill_version_id) REFERENCES skill_versions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS skill_proposals (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_session_id TEXT,
            proposed_by TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            suggested_name TEXT,
            suggested_category TEXT,
            suggested_scope_json TEXT NOT NULL DEFAULT '{}',
            content_md TEXT NOT NULL,
            source_summary TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            converted_skill_id TEXT,
            converted_version_id TEXT,
            reviewer_id TEXT,
            review_comment TEXT,
            created_at BIGINT NOT NULL,
            reviewed_at BIGINT,
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY(converted_skill_id) REFERENCES skill_definitions(id) ON DELETE SET NULL,
            FOREIGN KEY(converted_version_id) REFERENCES skill_versions(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_skill_proposals_org_status ON skill_proposals(organization_id, status);

        CREATE TABLE IF NOT EXISTS skill_audit_logs (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            actor_user_id TEXT NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            before_json TEXT,
            after_json TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at BIGINT NOT NULL,
            FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_skill_audit_org_created ON skill_audit_logs(organization_id, created_at);
        """
    )
    _ensure_default_organization(conn)
    _ensure_schema_compat(conn)
    _seed_employee_profiles_from_memberships(conn)
    _seed_default_skills(conn)
    conn.commit()


def _ensure_default_organization(conn: Any) -> None:
    now = now_ms()
    conn.execute(
        """
        INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
        ON CONFLICT (id) DO NOTHING
        """,
        ("default", "Default Organization", "default", now, now),
    )


def _table_columns(conn: Any, table: str) -> set[str]:
    return {
        str(row["column_name"])
        for row in conn.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ?
            """,
            (table,),
        ).fetchall()
    }


def _ensure_schema_compat(conn: Any) -> None:
    skill_file_columns = _table_columns(conn, "skill_files")
    if "file_kind" not in skill_file_columns:
        conn.execute("ALTER TABLE skill_files ADD COLUMN file_kind TEXT")
        conn.execute("UPDATE skill_files SET file_kind = file_type WHERE file_kind IS NULL")

    feedback_columns = _table_columns(conn, "skill_feedback")
    if "comment" not in feedback_columns:
        conn.execute("ALTER TABLE skill_feedback ADD COLUMN comment TEXT")
        conn.execute("UPDATE skill_feedback SET comment = feedback_text WHERE comment IS NULL")
    if "status" not in feedback_columns:
        conn.execute("ALTER TABLE skill_feedback ADD COLUMN status TEXT NOT NULL DEFAULT 'open'")

    employee_columns = _table_columns(conn, "employee_profiles")
    if "email" not in employee_columns:
        conn.execute("ALTER TABLE employee_profiles ADD COLUMN email TEXT")


def _seed_employee_profiles_from_memberships(conn: Any) -> None:
    if not _table_columns(conn, "users"):
        return
    now = now_ms()
    conn.execute(
        """
        INSERT INTO employee_profiles
            (id, organization_id, user_id, display_name, status, created_at, updated_at)
        SELECT
            'emp_' || md5(m.organization_id || ':' || m.user_id),
            m.organization_id,
            m.user_id,
            COALESCE(NULLIF(u.username, ''), m.user_id),
            'active',
            COALESCE(m.created_at, ?),
            COALESCE(m.updated_at, m.created_at, ?)
        FROM user_organization_memberships m
        JOIN users u ON CAST(u.id AS TEXT) = m.user_id
        ON CONFLICT (organization_id, user_id) DO NOTHING
        """,
        (now, now),
    )


def _seed_default_skills(conn: Any) -> None:
    existing = conn.execute(
        "SELECT id FROM skill_definitions WHERE organization_id = 'default' AND name = 'crossborder-deepseen'"
    ).fetchone()
    if existing:
        return
    repo_root = Path(__file__).resolve().parents[2]
    skill_md = repo_root / "skills" / "crossborder-deepseen" / "SKILL.md"
    if not skill_md.exists():
        return
    content = skill_md.read_text(encoding="utf-8")
    now = now_ms()
    skill_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    visibility_id = str(uuid.uuid4())
    digest = __import__("hashlib").sha256(content.encode("utf-8")).hexdigest()
    display_name = "\u8de8\u5883 DeepSeen \u5206\u6790"
    description = (
        "Herbound \u8de8\u5883\u573a\u666f\u5185\u7f6e DeepSeen \u5de5\u5177\u6280\u80fd\uff0c"
        "\u7528\u4e8e\u5546\u54c1\u3001\u7ade\u54c1\u3001\u8fbe\u4eba\u3001\u7d20\u6750\u3001"
        "\u56fe\u7247\u548c\u89c6\u9891\u751f\u6210\u5206\u6790\u3002"
    )
    category = "\u8de8\u5883\u5206\u6790"
    conn.execute(
        """
        INSERT INTO skill_definitions
            (id, organization_id, name, display_name, description, category, business_domain,
             status, latest_version_id, published_version_id, owner_user_id, created_by,
             updated_by, created_at, updated_at)
        VALUES (?, 'default', 'crossborder-deepseen', ?, ?, ?, 'DeepSeen', 'published', ?, ?, 'system', 'system',
                'system', ?, ?)
        """,
        (skill_id, display_name, description, category, version_id, version_id, now, now),
    )
    conn.execute(
        """
        INSERT INTO skill_versions
            (id, organization_id, skill_id, version, semver, content_md, frontmatter_json,
             status, content_sha256, created_by, reviewed_by, published_by,
             created_at, reviewed_at, published_at)
        VALUES (?, 'default', ?, 1, '1.0.0', ?, '{}', 'published', ?, 'system',
                'system', 'system', ?, ?, ?)
        """,
        (version_id, skill_id, content, digest, now, now, now),
    )
    conn.execute(
        """
        INSERT INTO skill_visibility_rules
            (id, organization_id, skill_id, scope_type, scope_id, access_level, created_by, created_at)
        VALUES (?, 'default', ?, 'organization', 'default', 'use', 'system', ?)
        """,
        (visibility_id, skill_id, now),
    )
