from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any

from hermes_constants import set_runtime_skills_dir

from .db import now_ms, runtime_root
from .service import json_dumps, new_id, service, validate_support_file_path


def _snapshot_hash(items: list[dict[str, Any]]) -> str:
    payload = [
        {
            "skill_id": item["id"],
            "name": item["name"],
            "version_id": item.get("published_version_id"),
            "content_sha256": (item.get("published_version") or {}).get("content_sha256"),
        }
        for item in items
    ]
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _safe_write_text(root: Path, rel_path: str, content: str) -> None:
    rel = validate_support_file_path(rel_path)
    target = (root / rel).resolve()
    resolved_root = root.resolve()
    if not str(target).startswith(str(resolved_root)):
        raise ValueError("Runtime support file escaped skill root.")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def _materialize_skill(conn, root: Path, skill: dict[str, Any]) -> None:
    version = skill.get("published_version")
    if not version:
        return
    skill_dir = root / skill["name"]
    if skill_dir.exists():
        shutil.rmtree(skill_dir)
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(version["content_md"], encoding="utf-8")
    rows = conn.execute(
        "SELECT * FROM skill_files WHERE skill_version_id = ? ORDER BY path ASC",
        (version["id"],),
    ).fetchall()
    for row in rows:
        path = str(row["path"] or "")
        if row["content_text"] is not None:
            _safe_write_text(skill_dir, path, str(row["content_text"]))
        elif row["object_url"]:
            _safe_write_text(skill_dir, path + ".url", str(row["object_url"]))


def create_runtime_snapshot(
    conn,
    *,
    organization_id: str = "default",
    user_id: str,
    session_id: str,
    profile_id: str | None = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    if not force_refresh:
        existing = conn.execute(
            """
            SELECT * FROM skill_runtime_snapshots
            WHERE organization_id = ? AND user_id = ? AND session_id = ? AND status = 'active'
            """,
            (organization_id, str(user_id), session_id),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE skill_runtime_snapshots SET last_used_at = ? WHERE id = ?",
                (now_ms(), existing["id"]),
            )
            return {
                "snapshot_id": existing["id"],
                "snapshot_hash": existing["snapshot_hash"],
                "runtime_skills_dir": existing["runtime_skills_dir"],
                "skill_count": len(json.loads(existing["skill_ids_json"] or "[]")),
                "skill_ids": json.loads(existing["skill_ids_json"] or "[]"),
                "version_ids": json.loads(existing["version_ids_json"] or "[]"),
            }

    skills = service.available_skills(
        conn,
        user_id=str(user_id),
        organization_id=organization_id,
        profile_id=profile_id,
    )
    snap_hash = _snapshot_hash(skills)
    root = runtime_root() / f"org_{organization_id}" / "snapshots" / snap_hash / "skills"
    root.mkdir(parents=True, exist_ok=True)
    for child in root.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    for skill in skills:
        _materialize_skill(conn, root, skill)
    manifest = {
        "organization_id": organization_id,
        "skills": {
            skill["name"]: {
                "skill_id": skill["id"],
                "version_id": skill.get("published_version_id"),
            }
            for skill in skills
        },
    }
    (root / ".enterprise_skill_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    snapshot_id = new_id()
    skill_ids = [skill["id"] for skill in skills]
    version_ids = [skill["published_version_id"] for skill in skills if skill.get("published_version_id")]
    now = now_ms()
    conn.execute(
        "UPDATE skill_runtime_snapshots SET status = 'superseded' WHERE organization_id = ? AND session_id = ?",
        (organization_id, session_id),
    )
    conn.execute(
        """
        INSERT INTO skill_runtime_snapshots
            (id, organization_id, user_id, session_id, profile_id, skill_ids_json,
             version_ids_json, snapshot_hash, runtime_skills_dir, status, created_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        """,
        (
            snapshot_id,
            organization_id,
            str(user_id),
            session_id,
            profile_id,
            json_dumps(skill_ids),
            json_dumps(version_ids),
            snap_hash,
            str(root),
            now,
            now,
        ),
    )
    return {
        "snapshot_id": snapshot_id,
        "snapshot_hash": snap_hash,
        "runtime_skills_dir": str(root),
        "skill_count": len(skills),
        "skill_ids": skill_ids,
        "version_ids": version_ids,
    }


def apply_runtime_env(runtime_skills_dir: str | None) -> None:
    """Set or clear the current runtime skill directory.

    The context-local value is what normal in-process skill scanners read. The
    environment variable remains as a compatibility fallback for code paths that
    cross a process boundary.
    """
    set_runtime_skills_dir(runtime_skills_dir)
    if runtime_skills_dir:
        os.environ["HERMES_RUNTIME_SKILLS_DIR"] = runtime_skills_dir
    else:
        os.environ.pop("HERMES_RUNTIME_SKILLS_DIR", None)
