from __future__ import annotations

import hashlib
import json
import re
import uuid
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from agent.skill_utils import parse_frontmatter

from .db import now_ms
from .governance import enforce_publishable


_SKILL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


def new_id() -> str:
    return str(uuid.uuid4())


def content_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def row_to_dict(row: Any | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def validate_skill_name(name: str) -> str:
    cleaned = str(name or "").strip()
    if not _SKILL_NAME_RE.match(cleaned):
        raise ValueError("Skill name must use lowercase letters, numbers, '.', '-' or '_' and be at most 64 chars.")
    if PurePosixPath(cleaned).is_absolute() or PureWindowsPath(cleaned).is_absolute() or PureWindowsPath(cleaned).drive:
        raise ValueError("Skill name must be relative.")
    if ".." in PurePosixPath(cleaned).parts:
        raise ValueError("Skill name cannot contain path traversal.")
    return cleaned


def validate_support_file_path(path: str) -> str:
    cleaned = str(path or "").replace("\\", "/").strip()
    if not cleaned:
        raise ValueError("File path is required.")
    posix = PurePosixPath(cleaned)
    win = PureWindowsPath(cleaned)
    if posix.is_absolute() or win.is_absolute() or win.drive or ".." in posix.parts:
        raise ValueError("Support file path must stay inside the skill directory.")
    return cleaned


def safe_skill_name_hint(value: str, fallback_prefix: str = "enterprise-skill") -> str:
    cleaned = re.sub(r"[^a-z0-9_-]+", "-", str(value or "").lower()).strip("-_")
    cleaned = re.sub(r"[-_]{2,}", "-", cleaned)
    if not cleaned or not re.match(r"^[a-z0-9]", cleaned):
        cleaned = f"{fallback_prefix}-{uuid.uuid4().hex[:8]}"
    return validate_skill_name(cleaned[:64].rstrip("-_"))


class EnterpriseSkillService:
    def ensure_organization(self, conn: Any, organization_id: str, name: str | None = None) -> None:
        org_id = str(organization_id or "default").strip() or "default"
        now = now_ms()
        conn.execute(
            """
            INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
            VALUES (?, ?, ?, 'active', ?, ?)
            ON CONFLICT (id) DO NOTHING
            """,
            (org_id, name or org_id, org_id, now, now),
        )

    def ensure_membership(self, conn: Any, user_id: str, role: str = "member", organization_id: str = "default") -> None:
        self.ensure_organization(conn, organization_id)
        now = now_ms()
        conn.execute(
            """
            INSERT INTO user_organization_memberships
                (id, organization_id, user_id, role, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?)
            ON CONFLICT (organization_id, user_id) DO NOTHING
            """,
            (new_id(), str(organization_id), str(user_id), role, now, now),
        )

    def ensure_default_membership(self, conn: Any, user_id: str, role: str = "org_admin") -> None:
        self.ensure_membership(conn, user_id, role, "default")

    def organization_role(self, conn: Any, user_id: str, organization_id: str = "default") -> str:
        row = conn.execute(
            """
            SELECT role FROM user_organization_memberships
            WHERE organization_id = ? AND user_id = ? AND status = 'active'
            """,
            (organization_id, str(user_id)),
        ).fetchone()
        return str(row["role"]) if row else "member"

    def list_organizations_for_user(self, conn: Any, user_id: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            """
            SELECT o.*, m.role
            FROM organizations o
            JOIN user_organization_memberships m ON m.organization_id = o.id
            WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'
            ORDER BY o.created_at ASC
            """,
            (str(user_id),),
        ).fetchall()
        return [row_to_dict(row) or {} for row in rows]

    def create_team(
        self,
        conn: Any,
        *,
        organization_id: str,
        name: str,
        actor_user_id: str,
        parent_id: str | None = None,
    ) -> dict[str, Any]:
        self.ensure_organization(conn, organization_id)
        team_id = new_id()
        now = now_ms()
        conn.execute(
            """
            INSERT INTO teams (id, organization_id, name, parent_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?)
            """,
            (team_id, organization_id, name.strip(), parent_id, now, now),
        )
        self.audit(conn, organization_id, actor_user_id, "team.create", "team", team_id, None, {"name": name})
        return row_to_dict(conn.execute("SELECT * FROM teams WHERE id = ? AND organization_id = ?", (team_id, organization_id)).fetchone()) or {}

    def list_teams(self, conn: Any, organization_id: str = "default") -> list[dict[str, Any]]:
        rows = conn.execute(
            "SELECT * FROM teams WHERE organization_id = ? AND status = 'active' ORDER BY created_at DESC",
            (organization_id,),
        ).fetchall()
        return [row_to_dict(row) or {} for row in rows]

    def add_team_member(
        self,
        conn: Any,
        *,
        organization_id: str,
        team_id: str,
        user_id: str,
        role: str = "member",
        actor_user_id: str,
    ) -> dict[str, Any]:
        team = conn.execute("SELECT id FROM teams WHERE id = ? AND organization_id = ?", (team_id, organization_id)).fetchone()
        if not team:
            raise KeyError("Team not found.")
        self.ensure_membership(conn, user_id, "member", organization_id)
        now = now_ms()
        membership_id = new_id()
        conn.execute(
            """
            INSERT INTO user_team_memberships
                (id, organization_id, team_id, user_id, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (team_id, user_id) DO UPDATE SET
                id = EXCLUDED.id,
                organization_id = EXCLUDED.organization_id,
                role = EXCLUDED.role,
                created_at = EXCLUDED.created_at
            """,
            (membership_id, organization_id, team_id, str(user_id), role, now),
        )
        self.audit(conn, organization_id, actor_user_id, "team.member.add", "team", team_id, None, {"user_id": str(user_id), "role": role})
        return row_to_dict(conn.execute("SELECT * FROM user_team_memberships WHERE team_id = ? AND user_id = ?", (team_id, str(user_id))).fetchone()) or {}

    def list_team_members(self, conn: Any, organization_id: str, team_id: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            "SELECT * FROM user_team_memberships WHERE organization_id = ? AND team_id = ? ORDER BY created_at DESC",
            (organization_id, team_id),
        ).fetchall()
        return [row_to_dict(row) or {} for row in rows]

    def _user_summary_for_employee(self, conn: Any, user_id: str) -> dict[str, Any] | None:
        row = conn.execute(
            "SELECT id, username, role, status, avatar FROM users WHERE CAST(id AS TEXT) = ?",
            (str(user_id),),
        ).fetchone()
        return row_to_dict(row) if row else None

    def upsert_employee(
        self,
        conn: Any,
        *,
        organization_id: str,
        user_id: str,
        actor_user_id: str,
        display_name: str | None = None,
        employee_no: str | None = None,
        title: str | None = None,
        phone: str | None = None,
        email: str | None = None,
        status: str = "active",
        role: str = "member",
        team_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        user_id = str(user_id)
        self.ensure_membership(conn, user_id, role, organization_id)
        user = self._user_summary_for_employee(conn, user_id)
        now = now_ms()
        name = (display_name or (user or {}).get("username") or user_id).strip()
        existing = conn.execute(
            "SELECT id FROM employee_profiles WHERE organization_id = ? AND user_id = ?",
            (organization_id, user_id),
        ).fetchone()
        if existing:
            employee_id = existing["id"]
            conn.execute(
                """
                UPDATE employee_profiles
                SET employee_no = ?, display_name = ?, title = ?, phone = ?, email = ?,
                    status = ?, updated_at = ?
                WHERE id = ?
                """,
                (employee_no, name, title, phone, email, status, now, employee_id),
            )
        else:
            employee_id = new_id()
            conn.execute(
                """
                INSERT INTO employee_profiles
                    (id, organization_id, user_id, employee_no, display_name, title,
                     phone, email, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (employee_id, organization_id, user_id, employee_no, name, title, phone, email, status, now, now),
            )
        if team_ids is not None:
            conn.execute(
                "DELETE FROM user_team_memberships WHERE organization_id = ? AND user_id = ?",
                (organization_id, user_id),
            )
            for team_id in team_ids:
                if not str(team_id).strip():
                    continue
                self.add_team_member(
                    conn,
                    organization_id=organization_id,
                    team_id=str(team_id),
                    user_id=user_id,
                    role="member",
                    actor_user_id=actor_user_id,
                )
        self.audit(conn, organization_id, actor_user_id, "employee.upsert", "employee", user_id, None, {"team_ids": team_ids or []})
        return self.get_employee(conn, organization_id, user_id) or {}

    def get_employee(self, conn: Any, organization_id: str, user_id: str) -> dict[str, Any] | None:
        row = conn.execute(
            "SELECT * FROM employee_profiles WHERE organization_id = ? AND user_id = ?",
            (organization_id, str(user_id)),
        ).fetchone()
        if not row:
            return None
        employee = row_to_dict(row) or {}
        employee["user"] = self._user_summary_for_employee(conn, str(user_id))
        employee["organization"] = row_to_dict(conn.execute("SELECT * FROM organizations WHERE id = ?", (organization_id,)).fetchone())
        employee["teams"] = self.list_employee_teams(conn, organization_id, str(user_id))
        employee["skills"] = self.list_employee_skills(conn, organization_id, str(user_id))
        return employee

    def list_employee_teams(self, conn: Any, organization_id: str, user_id: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            """
            SELECT t.*, m.role AS membership_role, m.created_at AS member_created_at
            FROM user_team_memberships m
            JOIN teams t ON t.id = m.team_id AND t.organization_id = m.organization_id
            WHERE m.organization_id = ? AND m.user_id = ?
            ORDER BY t.created_at ASC
            """,
            (organization_id, str(user_id)),
        ).fetchall()
        return [row_to_dict(row) or {} for row in rows]

    def list_employees(
        self,
        conn: Any,
        organization_id: str = "default",
        team_id: str | None = None,
        keyword: str | None = None,
        status: str | None = "active",
    ) -> list[dict[str, Any]]:
        params: list[Any] = [organization_id]
        where = ["e.organization_id = ?"]
        if status:
            where.append("e.status = ?")
            params.append(status)
        if keyword:
            like = f"%{keyword}%"
            where.append("(e.display_name ILIKE ? OR e.employee_no ILIKE ? OR e.email ILIKE ? OR e.user_id ILIKE ?)")
            params.extend([like, like, like, like])
        if team_id:
            where.append(
                "EXISTS (SELECT 1 FROM user_team_memberships tm WHERE tm.organization_id = e.organization_id AND tm.user_id = e.user_id AND tm.team_id = ?)"
            )
            params.append(team_id)
        rows = conn.execute(
            f"""
            SELECT e.*
            FROM employee_profiles e
            WHERE {' AND '.join(where)}
            ORDER BY e.created_at DESC
            """,
            params,
        ).fetchall()
        return [self.get_employee(conn, organization_id, str(row["user_id"])) or {} for row in rows]

    def assign_employee_skill(
        self,
        conn: Any,
        *,
        organization_id: str,
        user_id: str,
        skill_id: str,
        access_level: str = "use",
        actor_user_id: str,
    ) -> dict[str, Any]:
        if not self.get_employee(conn, organization_id, user_id):
            raise KeyError("Employee not found.")
        skill = conn.execute(
            "SELECT id FROM skill_definitions WHERE id = ? AND organization_id = ?",
            (skill_id, organization_id),
        ).fetchone()
        if not skill:
            raise KeyError("Skill not found.")
        now = now_ms()
        assignment_id = new_id()
        conn.execute(
            """
            INSERT INTO employee_skill_assignments
                (id, organization_id, user_id, skill_id, access_level, assigned_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (organization_id, user_id, skill_id, access_level) DO NOTHING
            """,
            (assignment_id, organization_id, str(user_id), skill_id, access_level, actor_user_id, now),
        )
        self.add_visibility_rule(
            conn,
            skill_id=skill_id,
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            scope_type="user",
            scope_id=str(user_id),
            access_level=access_level,
        )
        self.audit(conn, organization_id, actor_user_id, "employee.skill.assign", "employee", str(user_id), None, {"skill_id": skill_id, "access_level": access_level})
        return self.get_employee_skill_assignment(conn, organization_id, str(user_id), skill_id, access_level) or {}

    def get_employee_skill_assignment(self, conn: Any, organization_id: str, user_id: str, skill_id: str, access_level: str) -> dict[str, Any] | None:
        row = conn.execute(
            """
            SELECT a.*, s.name AS skill_name, s.display_name AS skill_display_name, s.status AS skill_status
            FROM employee_skill_assignments a
            JOIN skill_definitions s ON s.id = a.skill_id
            WHERE a.organization_id = ? AND a.user_id = ? AND a.skill_id = ? AND a.access_level = ?
            """,
            (organization_id, str(user_id), skill_id, access_level),
        ).fetchone()
        return row_to_dict(row) if row else None

    def list_employee_skills(self, conn: Any, organization_id: str, user_id: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            """
            SELECT a.*, s.name AS skill_name, s.display_name AS skill_display_name,
                   s.description AS skill_description, s.status AS skill_status
            FROM employee_skill_assignments a
            JOIN skill_definitions s ON s.id = a.skill_id
            WHERE a.organization_id = ? AND a.user_id = ?
            ORDER BY a.created_at DESC
            """,
            (organization_id, str(user_id)),
        ).fetchall()
        return [row_to_dict(row) or {} for row in rows]

    def remove_employee_skill(
        self,
        conn: Any,
        *,
        organization_id: str,
        user_id: str,
        skill_id: str,
        access_level: str = "use",
        actor_user_id: str,
    ) -> dict[str, Any]:
        conn.execute(
            """
            DELETE FROM employee_skill_assignments
            WHERE organization_id = ? AND user_id = ? AND skill_id = ? AND access_level = ?
            """,
            (organization_id, str(user_id), skill_id, access_level),
        )
        conn.execute(
            """
            DELETE FROM skill_visibility_rules
            WHERE organization_id = ? AND skill_id = ? AND scope_type = 'user'
              AND scope_id = ? AND access_level = ?
            """,
            (organization_id, skill_id, str(user_id), access_level),
        )
        self.audit(conn, organization_id, actor_user_id, "employee.skill.remove", "employee", str(user_id), None, {"skill_id": skill_id, "access_level": access_level})
        return {"ok": True, "user_id": str(user_id), "skill_id": skill_id, "access_level": access_level}

    def list_skills(
        self,
        conn: Any,
        organization_id: str = "default",
        status: str | None = None,
        category: str | None = None,
        keyword: str | None = None,
        scope: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict[str, Any]:
        params: list[Any] = [organization_id]
        where = "organization_id = ?"
        if status:
            where += " AND status = ?"
            params.append(status)
        if category:
            where += " AND category = ?"
            params.append(category)
        if keyword:
            where += " AND (name LIKE ? OR display_name LIKE ? OR description LIKE ? OR business_domain LIKE ?)"
            like = f"%{keyword}%"
            params.extend([like, like, like, like])
        if scope:
            where += """
                AND EXISTS (
                    SELECT 1 FROM skill_visibility_rules r
                    WHERE r.skill_id = skill_definitions.id
                      AND r.organization_id = skill_definitions.organization_id
                      AND r.scope_type = ?
                )
            """
            params.append(scope)
        page = max(1, int(page or 1))
        page_size = min(200, max(1, int(page_size or 50)))
        total = int(conn.execute(f"SELECT COUNT(*) FROM skill_definitions WHERE {where}", params).fetchone()[0])
        rows = conn.execute(
            f"""
            SELECT * FROM skill_definitions
            WHERE {where}
            ORDER BY updated_at DESC, created_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, (page - 1) * page_size],
        ).fetchall()
        items = [self._hydrate_skill(conn, row) for row in rows]
        for item in items:
            item["visibility_rules"] = self.list_visibility_rules(conn, item["id"], organization_id)
            item["usage_count"] = self.usage_count(conn, item["id"], organization_id)
            item["last_used_at"] = self.last_used_at(conn, item["id"], organization_id)
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    def get_skill(self, conn: Any, skill_id: str, organization_id: str = "default") -> dict[str, Any] | None:
        row = conn.execute(
            "SELECT * FROM skill_definitions WHERE id = ? AND organization_id = ?",
            (skill_id, organization_id),
        ).fetchone()
        if not row:
            return None
        skill = self._hydrate_skill(conn, row)
        skill["versions"] = self.list_versions(conn, skill_id, organization_id)
        skill["visibility_rules"] = self.list_visibility_rules(conn, skill_id, organization_id)
        skill["files"] = self.list_files(conn, skill_id, skill.get("latest_version_id"), organization_id)
        skill["usage_count"] = self.usage_count(conn, skill_id, organization_id)
        skill["last_used_at"] = self.last_used_at(conn, skill_id, organization_id)
        return skill

    def get_skill_by_name(self, conn: Any, name: str, organization_id: str = "default") -> dict[str, Any] | None:
        row = conn.execute(
            "SELECT * FROM skill_definitions WHERE name = ? AND organization_id = ?",
            (name, organization_id),
        ).fetchone()
        return self._hydrate_skill(conn, row) if row else None

    def create_skill(
        self,
        conn: Any,
        *,
        name: str,
        content_md: str,
        actor_user_id: str,
        organization_id: str = "default",
        display_name: str | None = None,
        description: str | None = None,
        category: str | None = None,
        business_domain: str | None = None,
        visibility: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        name = validate_skill_name(name)
        now = now_ms()
        skill_id = new_id()
        version_id = new_id()
        frontmatter, _body = parse_frontmatter(content_md)
        fm_name = str(frontmatter.get("name") or "").strip()
        fm_desc = str(frontmatter.get("description") or "").strip()
        display_name = display_name or fm_name or name
        description = description if description is not None else fm_desc
        category = category or str(frontmatter.get("category") or "").strip() or None
        conn.execute(
            """
            INSERT INTO skill_definitions
                (id, organization_id, name, display_name, description, category, business_domain,
                 status, latest_version_id, owner_user_id, created_by, updated_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
            """,
            (
                skill_id,
                organization_id,
                name,
                display_name,
                description,
                category,
                business_domain,
                version_id,
                actor_user_id,
                actor_user_id,
                actor_user_id,
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO skill_versions
                (id, organization_id, skill_id, version, content_md, frontmatter_json, status,
                 content_sha256, created_by, created_at)
            VALUES (?, ?, ?, 1, ?, ?, 'draft', ?, ?, ?)
            """,
            (version_id, organization_id, skill_id, content_md, json_dumps(frontmatter), content_hash(content_md), actor_user_id, now),
        )
        for rule in visibility or [{"scope_type": "organization", "scope_id": organization_id, "access_level": "use"}]:
            self.add_visibility_rule(conn, skill_id=skill_id, organization_id=organization_id, actor_user_id=actor_user_id, **rule)
        self.audit(conn, organization_id, actor_user_id, "skill.create", "skill", skill_id, None, {"name": name})
        return self.get_skill(conn, skill_id, organization_id) or {}

    def update_draft(
        self,
        conn: Any,
        *,
        skill_id: str,
        content_md: str,
        actor_user_id: str,
        organization_id: str = "default",
        changelog: str | None = None,
    ) -> dict[str, Any]:
        skill = self.get_skill(conn, skill_id, organization_id)
        if not skill:
            raise KeyError("Skill not found.")
        latest = skill.get("latest_version")
        now = now_ms()
        if latest and latest.get("status") in {"draft", "rejected"}:
            version_id = latest["id"]
            frontmatter, _body = parse_frontmatter(content_md)
            conn.execute(
                """
                UPDATE skill_versions
                SET content_md = ?, frontmatter_json = ?, content_sha256 = ?, changelog = ?,
                    status = 'draft', created_by = ?, created_at = ?
                WHERE id = ? AND organization_id = ?
                """,
                (content_md, json_dumps(frontmatter), content_hash(content_md), changelog, actor_user_id, now, version_id, organization_id),
            )
        else:
            version_num = int((latest or {}).get("version") or 0) + 1
            version_id = new_id()
            frontmatter, _body = parse_frontmatter(content_md)
            conn.execute(
                """
                INSERT INTO skill_versions
                    (id, organization_id, skill_id, version, content_md, frontmatter_json, status,
                     content_sha256, changelog, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
                """,
                (version_id, organization_id, skill_id, version_num, content_md, json_dumps(frontmatter), content_hash(content_md), changelog, actor_user_id, now),
            )
            conn.execute(
                "UPDATE skill_definitions SET latest_version_id = ?, updated_by = ?, updated_at = ? WHERE id = ?",
                (version_id, actor_user_id, now, skill_id),
            )
        self.audit(conn, organization_id, actor_user_id, "skill.draft.update", "skill", skill_id, None, {"version_id": version_id})
        return self.get_skill(conn, skill_id, organization_id) or {}

    def submit_review(self, conn: Any, skill_id: str, actor_user_id: str, organization_id: str = "default") -> dict[str, Any]:
        version = self._latest_version(conn, skill_id, organization_id)
        if not version:
            raise KeyError("Skill version not found.")
        if version.get("status") not in {"draft", "rejected"}:
            raise ValueError("Only draft or rejected versions can be submitted for review.")
        now = now_ms()
        conn.execute(
            "UPDATE skill_versions SET status = 'pending_review', reviewed_at = NULL, reviewed_by = NULL WHERE id = ?",
            (version["id"],),
        )
        conn.execute(
            "UPDATE skill_definitions SET status = 'review', updated_by = ?, updated_at = ? WHERE id = ?",
            (actor_user_id, now, skill_id),
        )
        self.audit(conn, organization_id, actor_user_id, "skill.submit_review", "skill", skill_id, None, {"version_id": version["id"]})
        return self.get_skill(conn, skill_id, organization_id) or {}

    def approve_version(self, conn: Any, skill_id: str, actor_user_id: str, organization_id: str = "default") -> dict[str, Any]:
        version = self._latest_version(conn, skill_id, organization_id)
        if not version:
            raise KeyError("Skill version not found.")
        if version.get("status") != "pending_review":
            raise ValueError("Only pending review versions can be approved.")
        enforce_publishable(version.get("content_md") or "")
        now = now_ms()
        conn.execute(
            "UPDATE skill_versions SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?",
            (actor_user_id, now, version["id"]),
        )
        self.audit(conn, organization_id, actor_user_id, "skill.approve", "skill", skill_id, None, {"version_id": version["id"]})
        return self.get_skill(conn, skill_id, organization_id) or {}

    def reject_version(
        self,
        conn: Any,
        skill_id: str,
        actor_user_id: str,
        organization_id: str = "default",
        review_comment: str | None = None,
    ) -> dict[str, Any]:
        version = self._latest_version(conn, skill_id, organization_id)
        if not version:
            raise KeyError("Skill version not found.")
        if version.get("status") != "pending_review":
            raise ValueError("Only pending review versions can be rejected.")
        now = now_ms()
        conn.execute(
            "UPDATE skill_versions SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, reject_reason = ? WHERE id = ?",
            (actor_user_id, now, review_comment, version["id"]),
        )
        conn.execute(
            "UPDATE skill_definitions SET status = 'draft', updated_by = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
            (actor_user_id, now, skill_id, organization_id),
        )
        self.audit(conn, organization_id, actor_user_id, "skill.reject", "skill", skill_id, None, {"version_id": version["id"], "review_comment": review_comment})
        return self.get_skill(conn, skill_id, organization_id) or {}

    def publish_version(self, conn: Any, skill_id: str, actor_user_id: str, organization_id: str = "default") -> dict[str, Any]:
        version = self._latest_version(conn, skill_id, organization_id)
        if not version:
            raise KeyError("Skill version not found.")
        if version.get("status") != "approved":
            raise ValueError("Only approved versions can be published.")
        enforce_publishable(version.get("content_md") or "")
        now = now_ms()
        conn.execute(
            "UPDATE skill_versions SET status = 'archived' WHERE skill_id = ? AND status = 'published'",
            (skill_id,),
        )
        conn.execute(
            """
            UPDATE skill_versions
            SET status = 'published', published_by = ?, published_at = ?
            WHERE id = ?
            """,
            (actor_user_id, now, version["id"]),
        )
        conn.execute(
            """
            UPDATE skill_definitions
            SET status = 'published', published_version_id = ?, latest_version_id = ?,
                updated_by = ?, updated_at = ?
            WHERE id = ?
            """,
            (version["id"], version["id"], actor_user_id, now, skill_id),
        )
        self.audit(conn, organization_id, actor_user_id, "skill.publish", "skill", skill_id, None, {"version_id": version["id"]})
        return self.get_skill(conn, skill_id, organization_id) or {}

    def rollback(self, conn: Any, skill_id: str, target_version_id: str, actor_user_id: str, organization_id: str = "default") -> dict[str, Any]:
        target = conn.execute(
            "SELECT * FROM skill_versions WHERE id = ? AND skill_id = ? AND organization_id = ?",
            (target_version_id, skill_id, organization_id),
        ).fetchone()
        if not target:
            raise KeyError("Target version not found.")
        now = now_ms()
        conn.execute("UPDATE skill_versions SET status = 'archived' WHERE skill_id = ? AND status = 'published'", (skill_id,))
        conn.execute(
            "UPDATE skill_versions SET status = 'published', published_by = ?, published_at = ? WHERE id = ?",
            (actor_user_id, now, target_version_id),
        )
        conn.execute(
            "UPDATE skill_definitions SET status = 'published', published_version_id = ?, updated_by = ?, updated_at = ? WHERE id = ?",
            (target_version_id, actor_user_id, now, skill_id),
        )
        self.audit(conn, organization_id, actor_user_id, "skill.rollback", "skill", skill_id, None, {"version_id": target_version_id})
        return self.get_skill(conn, skill_id, organization_id) or {}

    def archive_skill(self, conn: Any, skill_id: str, actor_user_id: str, organization_id: str = "default") -> dict[str, Any]:
        now = now_ms()
        conn.execute(
            "UPDATE skill_definitions SET status = 'archived', archived_at = ?, updated_by = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
            (now, actor_user_id, now, skill_id, organization_id),
        )
        self.audit(conn, organization_id, actor_user_id, "skill.archive", "skill", skill_id, None, None)
        return {"ok": True, "skill_id": skill_id}

    def list_versions(self, conn: Any, skill_id: str, organization_id: str = "default") -> list[dict[str, Any]]:
        rows = conn.execute(
            """
            SELECT * FROM skill_versions
            WHERE skill_id = ? AND organization_id = ?
            ORDER BY version DESC
            """,
            (skill_id, organization_id),
        ).fetchall()
        return [self._decode_version(row_to_dict(row)) or {} for row in rows]

    def add_visibility_rule(
        self,
        conn: Any,
        *,
        skill_id: str,
        organization_id: str,
        actor_user_id: str,
        scope_type: str,
        scope_id: str,
        access_level: str = "use",
    ) -> None:
        now = now_ms()
        conn.execute(
            """
            INSERT INTO skill_visibility_rules
                (id, organization_id, skill_id, scope_type, scope_id, access_level, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (skill_id, scope_type, scope_id, access_level) DO NOTHING
            """,
            (new_id(), organization_id, skill_id, scope_type, str(scope_id), access_level, actor_user_id, now),
        )

    def list_visibility_rules(self, conn: Any, skill_id: str, organization_id: str = "default") -> list[dict[str, Any]]:
        rows = conn.execute(
            """
            SELECT * FROM skill_visibility_rules
            WHERE skill_id = ? AND organization_id = ?
            ORDER BY scope_type, scope_id, access_level
            """,
            (skill_id, organization_id),
        ).fetchall()
        return [row_to_dict(row) or {} for row in rows]

    def replace_visibility_rules(
        self,
        conn: Any,
        *,
        skill_id: str,
        organization_id: str,
        actor_user_id: str,
        rules: list[dict[str, str]],
    ) -> list[dict[str, Any]]:
        conn.execute(
            "DELETE FROM skill_visibility_rules WHERE skill_id = ? AND organization_id = ?",
            (skill_id, organization_id),
        )
        for rule in rules or [{"scope_type": "organization", "scope_id": organization_id, "access_level": "use"}]:
            self.add_visibility_rule(conn, skill_id=skill_id, organization_id=organization_id, actor_user_id=actor_user_id, **rule)
        self.audit(conn, organization_id, actor_user_id, "skill.visibility.replace", "skill", skill_id, None, {"rules": rules})
        return self.list_visibility_rules(conn, skill_id, organization_id)

    def list_files(self, conn: Any, skill_id: str, version_id: str | None, organization_id: str = "default") -> list[dict[str, Any]]:
        if not version_id:
            return []
        rows = conn.execute(
            """
            SELECT * FROM skill_files
            WHERE skill_id = ? AND skill_version_id = ? AND organization_id = ?
            ORDER BY path ASC
            """,
            (skill_id, version_id, organization_id),
        ).fetchall()
        return [row_to_dict(row) or {} for row in rows]

    def upsert_file(
        self,
        conn: Any,
        *,
        skill_id: str,
        version_id: str,
        organization_id: str,
        actor_user_id: str,
        path: str,
        content_text: str | None = None,
        object_url: str | None = None,
        mime_type: str | None = None,
        file_kind: str = "reference",
    ) -> dict[str, Any]:
        path = validate_support_file_path(path)
        now = now_ms()
        digest = content_hash(content_text or object_url or "")
        existing = conn.execute(
            "SELECT id FROM skill_files WHERE skill_version_id = ? AND path = ?",
            (version_id, path),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE skill_files
                SET file_type = ?, file_kind = ?, content_text = ?, object_url = ?, mime_type = ?, sha256 = ?
                WHERE id = ?
                """,
                (file_kind, file_kind, content_text, object_url, mime_type, digest, existing["id"]),
            )
            file_id = existing["id"]
        else:
            file_id = new_id()
            conn.execute(
                """
                INSERT INTO skill_files
                    (id, organization_id, skill_id, skill_version_id, file_type, file_kind,
                     path, content_text, object_url, mime_type, sha256, size_bytes, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    file_id,
                    organization_id,
                    skill_id,
                    version_id,
                    file_kind,
                    file_kind,
                    path,
                    content_text,
                    object_url,
                    mime_type,
                    digest,
                    len((content_text or object_url or "").encode("utf-8")),
                    actor_user_id,
                    now,
                ),
            )
        self.audit(conn, organization_id, actor_user_id, "skill.file.upsert", "skill", skill_id, None, {"path": path})
        return row_to_dict(conn.execute("SELECT * FROM skill_files WHERE id = ?", (file_id,)).fetchone()) or {}

    def delete_file(self, conn: Any, file_id: str, actor_user_id: str, organization_id: str = "default") -> dict[str, Any]:
        row = conn.execute("SELECT * FROM skill_files WHERE id = ? AND organization_id = ?", (file_id, organization_id)).fetchone()
        if not row:
            raise KeyError("File not found.")
        data = row_to_dict(row) or {}
        conn.execute("DELETE FROM skill_files WHERE id = ? AND organization_id = ?", (file_id, organization_id))
        self.audit(conn, organization_id, actor_user_id, "skill.file.delete", "skill", data.get("skill_id"), data, None)
        return {"ok": True, "file_id": file_id}

    def available_skills(
        self,
        conn: Any,
        *,
        user_id: str,
        organization_id: str = "default",
        profile_id: str | None = None,
    ) -> list[dict[str, Any]]:
        team_rows = conn.execute(
            "SELECT team_id FROM user_team_memberships WHERE organization_id = ? AND user_id = ?",
            (organization_id, str(user_id)),
        ).fetchall()
        team_ids = [str(row["team_id"]) for row in team_rows]
        member = conn.execute(
            "SELECT role FROM user_organization_memberships WHERE organization_id = ? AND user_id = ? AND status = 'active'",
            (organization_id, str(user_id)),
        ).fetchone()
        roles = [str(member["role"])] if member else ["member"]
        params: list[Any] = [organization_id]
        predicates = ["(r.scope_type = 'organization' AND r.scope_id = ?)"]
        params.append(organization_id)
        predicates.append("(r.scope_type = 'user' AND r.scope_id = ?)")
        params.append(str(user_id))
        if profile_id:
            predicates.append("(r.scope_type = 'profile' AND r.scope_id = ?)")
            params.append(profile_id)
        if roles:
            predicates.append(f"(r.scope_type = 'role' AND r.scope_id IN ({','.join('?' for _ in roles)}))")
            params.extend(roles)
        if team_ids:
            predicates.append(f"(r.scope_type = 'team' AND r.scope_id IN ({','.join('?' for _ in team_ids)}))")
            params.extend(team_ids)
        rows = conn.execute(
            f"""
            SELECT DISTINCT s.*
            FROM skill_definitions s
            JOIN skill_visibility_rules r ON r.skill_id = s.id
            WHERE s.organization_id = ?
              AND s.status = 'published'
              AND s.published_version_id IS NOT NULL
              AND r.access_level IN ('view', 'use', 'edit', 'approve', 'admin')
              AND ({' OR '.join(predicates)})
            ORDER BY s.display_name ASC
            """,
            params,
        ).fetchall()
        return [self._hydrate_skill(conn, row) for row in rows]

    def usage_count(self, conn: Any, skill_id: str, organization_id: str = "default") -> int:
        return int(conn.execute(
            "SELECT COUNT(*) FROM skill_usage_events WHERE skill_id = ? AND organization_id = ?",
            (skill_id, organization_id),
        ).fetchone()[0])

    def last_used_at(self, conn: Any, skill_id: str, organization_id: str = "default") -> int | None:
        row = conn.execute(
            "SELECT MAX(created_at) AS last_used_at FROM skill_usage_events WHERE skill_id = ? AND organization_id = ?",
            (skill_id, organization_id),
        ).fetchone()
        return row["last_used_at"] if row else None

    def list_usage_events(self, conn: Any, organization_id: str = "default", skill_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        params: list[Any] = [organization_id]
        where = "organization_id = ?"
        if skill_id:
            where += " AND skill_id = ?"
            params.append(skill_id)
        rows = conn.execute(
            f"SELECT * FROM skill_usage_events WHERE {where} ORDER BY created_at DESC LIMIT ?",
            [*params, min(500, max(1, int(limit or 100)))],
        ).fetchall()
        return [row_to_dict(row) or {} for row in rows]

    def record_usage_event(
        self,
        conn: Any,
        *,
        organization_id: str,
        user_id: str,
        session_id: str | None,
        profile_id: str | None,
        skill_id: str | None,
        skill_version_id: str | None,
        event_type: str,
        tool_name: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        event_id = new_id()
        conn.execute(
            """
            INSERT INTO skill_usage_events
                (id, organization_id, user_id, session_id, profile_id, skill_id,
                 skill_version_id, event_type, tool_name, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                organization_id,
                str(user_id),
                session_id,
                profile_id,
                skill_id,
                skill_version_id,
                event_type,
                tool_name,
                json_dumps(metadata or {}),
                now_ms(),
            ),
        )
        return row_to_dict(conn.execute("SELECT * FROM skill_usage_events WHERE id = ?", (event_id,)).fetchone()) or {}

    def record_runtime_skill_usage(
        self,
        conn: Any,
        *,
        runtime_skills_dir: str,
        skill_name: str | None,
        event_type: str,
        tool_name: str,
    ) -> dict[str, Any] | None:
        row = conn.execute(
            """
            SELECT * FROM skill_runtime_snapshots
            WHERE runtime_skills_dir = ? AND status = 'active'
            ORDER BY last_used_at DESC
            LIMIT 1
            """,
            (runtime_skills_dir,),
        ).fetchone()
        if not row:
            return None
        manifest_path = Path(runtime_skills_dir) / ".enterprise_skill_manifest.json"
        manifest: dict[str, Any] = {}
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                manifest = {}
        skill_meta = (manifest.get("skills") or {}).get(skill_name or "", {}) if isinstance(manifest, dict) else {}
        return self.record_usage_event(
            conn,
            organization_id=row["organization_id"],
            user_id=row["user_id"],
            session_id=row["session_id"],
            profile_id=row["profile_id"],
            skill_id=skill_meta.get("skill_id"),
            skill_version_id=skill_meta.get("version_id"),
            event_type=event_type,
            tool_name=tool_name,
            metadata={"skill_name": skill_name, "snapshot_hash": row["snapshot_hash"]},
        )

    def list_feedback(self, conn: Any, organization_id: str = "default", skill_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        params: list[Any] = [organization_id]
        where = "organization_id = ?"
        if skill_id:
            where += " AND skill_id = ?"
            params.append(skill_id)
        rows = conn.execute(
            f"SELECT * FROM skill_feedback WHERE {where} ORDER BY created_at DESC LIMIT ?",
            [*params, min(500, max(1, int(limit or 100)))],
        ).fetchall()
        return [row_to_dict(row) or {} for row in rows]

    def create_feedback(
        self,
        conn: Any,
        *,
        skill_id: str,
        actor_user_id: str,
        organization_id: str = "default",
        skill_version_id: str | None = None,
        rating: int | None = None,
        comment: str | None = None,
        status: str = "open",
    ) -> dict[str, Any]:
        feedback_id = new_id()
        conn.execute(
            """
            INSERT INTO skill_feedback
                (id, organization_id, skill_id, skill_version_id, user_id, rating, comment, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (feedback_id, organization_id, skill_id, skill_version_id, str(actor_user_id), rating, comment, status, now_ms()),
        )
        conn.execute(
            "UPDATE skill_feedback SET feedback_text = ? WHERE id = ?",
            (comment, feedback_id),
        )
        self.audit(conn, organization_id, actor_user_id, "skill.feedback.create", "skill", skill_id, None, {"feedback_id": feedback_id})
        return row_to_dict(conn.execute("SELECT * FROM skill_feedback WHERE id = ?", (feedback_id,)).fetchone()) or {}

    def list_audit_logs(self, conn: Any, organization_id: str = "default", target_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        params: list[Any] = [organization_id]
        where = "organization_id = ?"
        if target_id:
            where += " AND target_id = ?"
            params.append(target_id)
        rows = conn.execute(
            f"SELECT * FROM skill_audit_logs WHERE {where} ORDER BY created_at DESC LIMIT ?",
            [*params, min(500, max(1, int(limit or 100)))],
        ).fetchall()
        return [row_to_dict(row) or {} for row in rows]

    def create_proposal(
        self,
        conn: Any,
        *,
        title: str,
        content_md: str,
        proposed_by: str,
        organization_id: str = "default",
        source_type: str = "agent",
        source_session_id: str | None = None,
        description: str | None = None,
        suggested_name: str | None = None,
        suggested_category: str | None = None,
        source_summary: str | None = None,
        suggested_scope: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = now_ms()
        proposal_id = new_id()
        conn.execute(
            """
            INSERT INTO skill_proposals
                (id, organization_id, source_type, source_session_id, proposed_by, title,
                 description, suggested_name, suggested_category, suggested_scope_json,
                 content_md, source_summary, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (
                proposal_id,
                organization_id,
                source_type,
                source_session_id,
                proposed_by,
                title,
                description,
                suggested_name,
                suggested_category,
                json_dumps(suggested_scope or {}),
                content_md,
                source_summary,
                now,
            ),
        )
        self.audit(conn, organization_id, proposed_by, "skill.proposal.create", "proposal", proposal_id, None, {"title": title})
        return row_to_dict(conn.execute("SELECT * FROM skill_proposals WHERE id = ?", (proposal_id,)).fetchone()) or {}

    def list_proposals(self, conn: Any, organization_id: str = "default", status: str | None = None) -> list[dict[str, Any]]:
        params: list[Any] = [organization_id]
        where = "organization_id = ?"
        if status:
            where += " AND status = ?"
            params.append(status)
        rows = conn.execute(
            f"SELECT * FROM skill_proposals WHERE {where} ORDER BY created_at DESC",
            params,
        ).fetchall()
        return [self._decode_proposal(row_to_dict(row)) for row in rows]

    def get_proposal(self, conn: Any, proposal_id: str, organization_id: str = "default") -> dict[str, Any] | None:
        row = conn.execute(
            "SELECT * FROM skill_proposals WHERE id = ? AND organization_id = ?",
            (proposal_id, organization_id),
        ).fetchone()
        return self._decode_proposal(row_to_dict(row)) if row else None

    def review_proposal(
        self,
        conn: Any,
        *,
        proposal_id: str,
        actor_user_id: str,
        organization_id: str = "default",
        status: str,
        review_comment: str | None = None,
    ) -> dict[str, Any]:
        if status not in {"approved", "rejected"}:
            raise ValueError("Proposal status must be approved or rejected.")
        proposal = self.get_proposal(conn, proposal_id, organization_id)
        if not proposal:
            raise KeyError("Proposal not found.")
        conn.execute(
            """
            UPDATE skill_proposals
            SET status = ?, reviewer_id = ?, review_comment = ?, reviewed_at = ?
            WHERE id = ? AND organization_id = ?
            """,
            (status, str(actor_user_id), review_comment, now_ms(), proposal_id, organization_id),
        )
        self.audit(conn, organization_id, actor_user_id, f"skill.proposal.{status}", "proposal", proposal_id, proposal, {"status": status})
        return self.get_proposal(conn, proposal_id, organization_id) or {}

    def convert_proposal_to_skill(
        self,
        conn: Any,
        *,
        proposal_id: str,
        actor_user_id: str,
        organization_id: str = "default",
        name: str | None = None,
        display_name: str | None = None,
        publish: bool = False,
    ) -> dict[str, Any]:
        proposal = self.get_proposal(conn, proposal_id, organization_id)
        if not proposal:
            raise KeyError("Proposal not found.")
        enforce_publishable(proposal.get("content_md") or "")
        skill = self.create_skill(
            conn,
            name=safe_skill_name_hint(name or proposal.get("suggested_name") or proposal["title"]),
            display_name=display_name or proposal.get("title"),
            description=proposal.get("description"),
            category=proposal.get("suggested_category"),
            content_md=proposal["content_md"],
            actor_user_id=str(actor_user_id),
            organization_id=organization_id,
            visibility=[proposal.get("suggested_scope") or {"scope_type": "organization", "scope_id": organization_id, "access_level": "use"}],
        )
        if publish:
            skill = self.submit_review(conn, skill["id"], str(actor_user_id), organization_id)
            skill = self.approve_version(conn, skill["id"], str(actor_user_id), organization_id)
            skill = self.publish_version(conn, skill["id"], str(actor_user_id), organization_id)
        conn.execute(
            """
            UPDATE skill_proposals
            SET status = 'converted', converted_skill_id = ?, converted_version_id = ?,
                reviewer_id = ?, reviewed_at = ?
            WHERE id = ? AND organization_id = ?
            """,
            (skill["id"], skill.get("latest_version_id"), str(actor_user_id), now_ms(), proposal_id, organization_id),
        )
        self.audit(conn, organization_id, actor_user_id, "skill.proposal.convert", "proposal", proposal_id, proposal, {"skill_id": skill["id"]})
        return {"proposal": self.get_proposal(conn, proposal_id, organization_id), "skill": skill}

    def audit(
        self,
        conn: Any,
        organization_id: str,
        actor_user_id: str,
        action: str,
        target_type: str,
        target_id: str,
        before: Any,
        after: Any,
    ) -> None:
        conn.execute(
            """
            INSERT INTO skill_audit_logs
                (id, organization_id, actor_user_id, action, target_type, target_id, before_json, after_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (new_id(), organization_id, str(actor_user_id), action, target_type, str(target_id), json_dumps(before) if before is not None else None, json_dumps(after) if after is not None else None, now_ms()),
        )

    def _hydrate_skill(self, conn: Any, row: Any) -> dict[str, Any]:
        data = row_to_dict(row) or {}
        latest = row_to_dict(conn.execute("SELECT * FROM skill_versions WHERE id = ?", (data.get("latest_version_id"),)).fetchone())
        published = row_to_dict(conn.execute("SELECT * FROM skill_versions WHERE id = ?", (data.get("published_version_id"),)).fetchone())
        data["latest_version"] = self._decode_version(latest)
        data["published_version"] = self._decode_version(published)
        return data

    def _decode_version(self, version: dict[str, Any] | None) -> dict[str, Any] | None:
        if not version:
            return None
        for key, fallback in (
            ("frontmatter_json", {}),
            ("references_json", []),
            ("templates_json", []),
            ("assets_json", []),
            ("tools_json", []),
            ("output_rules_json", {}),
        ):
            version[key] = json_loads(version.get(key), fallback)
        return version

    def _decode_proposal(self, proposal: dict[str, Any] | None) -> dict[str, Any]:
        if not proposal:
            return {}
        proposal["suggested_scope"] = json_loads(proposal.get("suggested_scope_json"), {})
        return proposal

    def _latest_version(self, conn: Any, skill_id: str, organization_id: str) -> dict[str, Any] | None:
        row = conn.execute(
            """
            SELECT * FROM skill_versions
            WHERE skill_id = ? AND organization_id = ?
            ORDER BY version DESC
            LIMIT 1
            """,
            (skill_id, organization_id),
        ).fetchone()
        return self._decode_version(row_to_dict(row))


service = EnterpriseSkillService()
