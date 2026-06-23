from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from hermes_cli import postgres_store


def _now() -> float:
    return time.time()


def _encode_content(content: Any) -> Any:
    if isinstance(content, (dict, list)):
        return json.dumps(content, ensure_ascii=False)
    return content


def _decode_content(content: Any) -> Any:
    if not isinstance(content, str):
        return content
    text = content.strip()
    if not text or text[0] not in "[{":
        return content
    try:
        return json.loads(content)
    except Exception:
        return content


def _json(value: Any) -> Optional[str]:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _maybe_json(value: Any) -> Any:
    if not isinstance(value, str) or not value:
        return value
    try:
        return json.loads(value)
    except Exception:
        return value


class PostgresSessionDB:
    MAX_TITLE_LENGTH = 120

    def __init__(self, db_path: Path = None, read_only: bool = False):
        self.db_path = db_path
        self.read_only = read_only
        self._conn = postgres_store.connect()
        self._init_schema()

    def close(self) -> None:
        self._conn.close()

    def _init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                user_id TEXT,
                model TEXT,
                model_config TEXT,
                system_prompt TEXT,
                parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
                started_at DOUBLE PRECISION NOT NULL,
                ended_at DOUBLE PRECISION,
                end_reason TEXT,
                message_count INTEGER DEFAULT 0,
                tool_call_count INTEGER DEFAULT 0,
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cache_read_tokens INTEGER DEFAULT 0,
                cache_write_tokens INTEGER DEFAULT 0,
                reasoning_tokens INTEGER DEFAULT 0,
                cwd TEXT,
                billing_provider TEXT,
                billing_base_url TEXT,
                billing_mode TEXT,
                estimated_cost_usd DOUBLE PRECISION,
                actual_cost_usd DOUBLE PRECISION,
                cost_status TEXT,
                cost_source TEXT,
                pricing_version TEXT,
                title TEXT,
                api_call_count INTEGER DEFAULT 0,
                handoff_state TEXT,
                handoff_platform TEXT,
                handoff_error TEXT,
                rewind_count INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS messages (
                id BIGSERIAL PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT,
                tool_call_id TEXT,
                tool_calls TEXT,
                tool_name TEXT,
                timestamp DOUBLE PRECISION NOT NULL,
                token_count INTEGER,
                finish_reason TEXT,
                reasoning TEXT,
                reasoning_content TEXT,
                reasoning_details TEXT,
                codex_reasoning_items TEXT,
                codex_message_items TEXT,
                platform_message_id TEXT,
                observed INTEGER DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS state_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS compression_locks (
                session_id TEXT PRIMARY KEY,
                holder TEXT NOT NULL,
                acquired_at DOUBLE PRECISION NOT NULL,
                expires_at DOUBLE PRECISION NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source);
            CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_messages_session_active ON messages(session_id, active, timestamp);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_title_unique ON sessions(title) WHERE title IS NOT NULL;
            """
        )
        row = self._conn.execute("SELECT version FROM schema_version LIMIT 1").fetchone()
        if not row:
            self._conn.execute("INSERT INTO schema_version (version) VALUES (12)")
        self._conn.commit()

    def _insert_session_row(self, session_id: str, source: str, **kwargs) -> None:
        self._conn.execute(
            """
            INSERT INTO sessions (
                id, source, user_id, model, model_config, system_prompt,
                parent_session_id, cwd, started_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                session_id,
                source,
                kwargs.get("user_id"),
                kwargs.get("model"),
                _json(kwargs.get("model_config")),
                kwargs.get("system_prompt"),
                kwargs.get("parent_session_id"),
                kwargs.get("cwd"),
                _now(),
            ),
        )
        self._conn.commit()

    def create_session(self, session_id: str, source: str, **kwargs) -> str:
        self._insert_session_row(session_id, source, **kwargs)
        return session_id

    def ensure_session(self, session_id: str, source: str = "unknown", model: str = None, **kwargs) -> str:
        self._insert_session_row(session_id, source, model=model, **kwargs)
        return session_id

    def end_session(self, session_id: str, end_reason: str) -> None:
        self._conn.execute(
            "UPDATE sessions SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL",
            (_now(), end_reason, session_id),
        )
        self._conn.commit()

    def reopen_session(self, session_id: str) -> None:
        self._conn.execute("UPDATE sessions SET ended_at = NULL, end_reason = NULL WHERE id = ?", (session_id,))
        self._conn.commit()

    def update_session_cwd(self, session_id: str, cwd: str) -> None:
        self._conn.execute("UPDATE sessions SET cwd = ? WHERE id = ?", (cwd, session_id))
        self._conn.commit()

    def update_session_meta(self, session_id: str, model_config: Dict[str, Any] = None, model: str = None) -> None:
        self._conn.execute(
            "UPDATE sessions SET model_config = ?, model = COALESCE(?, model) WHERE id = ?",
            (_json(model_config), model, session_id),
        )
        self._conn.commit()

    def update_system_prompt(self, session_id: str, system_prompt: str) -> None:
        self._conn.execute("UPDATE sessions SET system_prompt = ? WHERE id = ?", (system_prompt, session_id))
        self._conn.commit()

    def update_session_model(self, session_id: str, model: str) -> None:
        self._conn.execute("UPDATE sessions SET model = ? WHERE id = ?", (model, session_id))
        self._conn.commit()

    def update_token_counts(self, session_id: str, **kwargs) -> None:
        self.ensure_session(session_id)
        fields = [
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_write_tokens",
            "reasoning_tokens",
            "api_call_count",
        ]
        sets = []
        params: list[Any] = []
        for field in fields:
            if kwargs.get(field) is not None:
                sets.append(f"{field} = COALESCE({field}, 0) + ?")
                params.append(int(kwargs[field] or 0))
        for field in (
            "billing_provider",
            "billing_base_url",
            "billing_mode",
            "estimated_cost_usd",
            "actual_cost_usd",
            "cost_status",
            "cost_source",
            "pricing_version",
        ):
            if field in kwargs:
                sets.append(f"{field} = ?")
                params.append(kwargs.get(field))
        if sets:
            params.append(session_id)
            self._conn.execute(f"UPDATE sessions SET {', '.join(sets)} WHERE id = ?", params)
            self._conn.commit()

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return dict(row) if row else None

    def resolve_session_id(self, session_id_or_prefix: str) -> Optional[str]:
        if not session_id_or_prefix:
            return None
        exact = self.get_session(session_id_or_prefix)
        if exact:
            return exact["id"]
        rows = self._conn.execute(
            "SELECT id FROM sessions WHERE id LIKE ? ORDER BY started_at DESC LIMIT 2",
            (f"{session_id_or_prefix}%",),
        ).fetchall()
        return rows[0]["id"] if len(rows) == 1 else None

    @classmethod
    def sanitize_title(cls, title: Optional[str]) -> Optional[str]:
        text = str(title or "").strip()
        if not text:
            return None
        return text[: cls.MAX_TITLE_LENGTH]

    def set_session_title(self, session_id: str, title: str) -> bool:
        clean = self.sanitize_title(title)
        existing = self._conn.execute(
            "SELECT id FROM sessions WHERE title = ? AND id != ?",
            (clean, session_id),
        ).fetchone()
        if clean and existing:
            raise ValueError(f"Session title already exists: {clean}")
        cur = self._conn.execute("UPDATE sessions SET title = ? WHERE id = ?", (clean, session_id))
        self._conn.commit()
        return cur.rowcount > 0

    def get_session_title(self, session_id: str) -> Optional[str]:
        row = self._conn.execute("SELECT title FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return row["title"] if row else None

    def get_session_by_title(self, title: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute("SELECT * FROM sessions WHERE title = ?", (title,)).fetchone()
        return dict(row) if row else None

    def resolve_session_by_title(self, title: str) -> Optional[str]:
        row = self.get_session_by_title(title)
        return row["id"] if row else None

    def set_session_archived(self, session_id: str, archived: bool) -> bool:
        cur = self._conn.execute(
            "UPDATE sessions SET archived = ? WHERE id = ?",
            (1 if archived else 0, session_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def append_message(
        self,
        session_id: str,
        role: str,
        content: Any = None,
        tool_call_id: str = None,
        tool_calls: Any = None,
        tool_name: str = None,
        token_count: int = None,
        finish_reason: str = None,
        reasoning: str = None,
        reasoning_content: str = None,
        reasoning_details: Any = None,
        codex_reasoning_items: Any = None,
        codex_message_items: Any = None,
        platform_message_id: str = None,
        observed: bool = False,
        active: bool = True,
        **kwargs,
    ) -> int:
        self.ensure_session(session_id)
        row = self._conn.execute(
            """
            INSERT INTO messages (
                session_id, role, content, tool_call_id, tool_calls, tool_name,
                timestamp, token_count, finish_reason, reasoning, reasoning_content,
                reasoning_details, codex_reasoning_items, codex_message_items,
                platform_message_id, observed, active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                session_id,
                role,
                _encode_content(content),
                tool_call_id,
                _json(tool_calls),
                tool_name,
                _now(),
                token_count,
                finish_reason,
                reasoning,
                reasoning_content,
                _json(reasoning_details),
                _json(codex_reasoning_items),
                _json(codex_message_items),
                platform_message_id,
                1 if observed else 0,
                1 if active else 0,
            ),
        ).fetchone()
        self._conn.execute(
            """
            UPDATE sessions
            SET message_count = COALESCE(message_count, 0) + 1,
                tool_call_count = COALESCE(tool_call_count, 0) + ?
            WHERE id = ?
            """,
            (1 if tool_calls else 0, session_id),
        )
        self._conn.commit()
        return int(row["id"])

    def replace_messages(self, session_id: str, messages: List[Dict[str, Any]]) -> None:
        self.ensure_session(session_id)
        self._conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        tool_count = 0
        for msg in messages:
            self._conn.execute(
                """
                INSERT INTO messages (
                    session_id, role, content, tool_call_id, tool_calls, tool_name,
                    timestamp, finish_reason, reasoning, reasoning_content, active
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    session_id,
                    msg.get("role"),
                    _encode_content(msg.get("content")),
                    msg.get("tool_call_id"),
                    _json(msg.get("tool_calls")),
                    msg.get("tool_name"),
                    _now(),
                    msg.get("finish_reason"),
                    msg.get("reasoning"),
                    msg.get("reasoning_content"),
                ),
            )
            if msg.get("tool_calls"):
                tool_count += 1
        self._conn.execute(
            "UPDATE sessions SET message_count = ?, tool_call_count = ? WHERE id = ?",
            (len(messages), tool_count, session_id),
        )
        self._conn.commit()

    def _message_dict(self, row: Any) -> Dict[str, Any]:
        item = dict(row)
        item["content"] = _decode_content(item.get("content"))
        for key in ("tool_calls", "reasoning_details", "codex_reasoning_items", "codex_message_items"):
            item[key] = _maybe_json(item.get(key))
        return item

    def get_messages(self, session_id: str, limit: int = None, offset: int = 0, active_only: bool = True) -> List[Dict[str, Any]]:
        where = "session_id = ?"
        params: list[Any] = [session_id]
        if active_only:
            where += " AND active = 1"
        sql = f"SELECT * FROM messages WHERE {where} ORDER BY timestamp ASC, id ASC"
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            params.extend([int(limit), int(offset or 0)])
        rows = self._conn.execute(sql, params).fetchall()
        return [self._message_dict(row) for row in rows]

    def get_messages_as_conversation(
        self,
        session_id: str,
        limit: int = None,
        include_inactive: bool = False,
        **kwargs,
    ) -> List[Dict[str, Any]]:
        messages = self.get_messages(session_id, limit=limit, active_only=not include_inactive)
        out: list[dict[str, Any]] = []
        for msg in messages:
            item = {"role": msg.get("role"), "content": msg.get("content")}
            for key in ("tool_call_id", "tool_calls", "tool_name", "reasoning", "reasoning_content"):
                if msg.get(key) is not None:
                    item[key] = msg.get(key)
            out.append(item)
        return out

    def list_sessions_rich(
        self,
        source: str = None,
        limit: int = 50,
        offset: int = 0,
        include_archived: bool = False,
        archived: Optional[bool] = None,
        **kwargs,
    ) -> List[Dict[str, Any]]:
        where = []
        params: list[Any] = []
        if source:
            where.append("s.source = ?")
            params.append(source)
        if archived is not None:
            where.append("COALESCE(s.archived, 0) = ?")
            params.append(1 if archived else 0)
        elif not include_archived:
            where.append("COALESCE(s.archived, 0) = 0")
        where_sql = "WHERE " + " AND ".join(where) if where else ""
        params.extend([int(limit or 50), int(offset or 0)])
        rows = self._conn.execute(
            f"""
            SELECT s.*,
                   COALESCE(m.last_active, s.started_at) AS last_active,
                   p.preview AS preview
            FROM sessions s
            LEFT JOIN (
                SELECT session_id, MAX(timestamp) AS last_active
                FROM messages
                WHERE active = 1
                GROUP BY session_id
            ) m ON m.session_id = s.id
            LEFT JOIN LATERAL (
                SELECT LEFT(REPLACE(REPLACE(content, CHR(10), ' '), CHR(13), ' '), 63) AS preview
                FROM messages
                WHERE session_id = s.id AND active = 1 AND content IS NOT NULL
                ORDER BY timestamp DESC, id DESC
                LIMIT 1
            ) p ON true
            {where_sql}
            ORDER BY COALESCE(m.last_active, s.started_at) DESC
            LIMIT ? OFFSET ?
            """,
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def search_sessions_by_id(self, query: str, limit: int = 20, include_archived: bool = False) -> List[Dict[str, Any]]:
        q = f"%{query or ''}%"
        where = "id ILIKE ?"
        params: list[Any] = [q]
        if not include_archived:
            where += " AND COALESCE(archived, 0) = 0"
        params.append(int(limit or 20))
        rows = self._conn.execute(
            f"SELECT * FROM sessions WHERE {where} ORDER BY started_at DESC LIMIT ?",
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def search_sessions(self, query: str, limit: int = 20, include_archived: bool = False) -> List[Dict[str, Any]]:
        q = f"%{query or ''}%"
        where = "(s.id ILIKE ? OR s.title ILIKE ? OR s.source ILIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id AND m.content ILIKE ?))"
        params: list[Any] = [q, q, q, q]
        if not include_archived:
            where += " AND COALESCE(s.archived, 0) = 0"
        params.append(int(limit or 20))
        rows = self._conn.execute(
            f"SELECT s.* FROM sessions s WHERE {where} ORDER BY s.started_at DESC LIMIT ?",
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def search_messages(self, query: str, limit: int = 50, **kwargs) -> List[Dict[str, Any]]:
        q = f"%{query or ''}%"
        rows = self._conn.execute(
            """
            SELECT m.id, m.session_id, m.role, m.content, m.timestamp, s.title, s.source
            FROM messages m
            JOIN sessions s ON s.id = m.session_id
            WHERE m.active = 1 AND (m.content ILIKE ? OR m.tool_name ILIKE ? OR m.tool_calls ILIKE ?)
            ORDER BY m.timestamp DESC
            LIMIT ?
            """,
            (q, q, q, int(limit or 50)),
        ).fetchall()
        return [dict(row) for row in rows]

    def session_count(self, source: str = None, include_archived: bool = False, **kwargs) -> int:
        where = []
        params: list[Any] = []
        if source:
            where.append("source = ?")
            params.append(source)
        if not include_archived:
            where.append("COALESCE(archived, 0) = 0")
        sql = "SELECT COUNT(*) AS c FROM sessions"
        if where:
            sql += " WHERE " + " AND ".join(where)
        row = self._conn.execute(sql, params).fetchone()
        return int(row["c"] if row else 0)

    def message_count(self, session_id: str = None) -> int:
        if session_id:
            row = self._conn.execute("SELECT COUNT(*) AS c FROM messages WHERE session_id = ?", (session_id,)).fetchone()
        else:
            row = self._conn.execute("SELECT COUNT(*) AS c FROM messages").fetchone()
        return int(row["c"] if row else 0)

    def clear_messages(self, session_id: str) -> None:
        self._conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        self._conn.execute("UPDATE sessions SET message_count = 0, tool_call_count = 0 WHERE id = ?", (session_id,))
        self._conn.commit()

    def delete_session(self, session_id: str, sessions_dir: Optional[Path] = None, **kwargs) -> bool:
        cur = self._conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        self._conn.commit()
        return cur.rowcount > 0

    def delete_sessions(self, session_ids: List[str], sessions_dir: Optional[Path] = None) -> Dict[str, Any]:
        deleted = []
        errors = []
        for sid in session_ids:
            if self.delete_session(sid, sessions_dir=sessions_dir):
                deleted.append(sid)
            else:
                errors.append({"id": sid, "error": "Session not found"})
        return {"deleted": deleted, "errors": errors, "deleted_count": len(deleted)}

    def delete_session_if_empty(self, session_id: str, sessions_dir: Optional[Path] = None) -> bool:
        if self.message_count(session_id) > 0:
            return False
        return self.delete_session(session_id, sessions_dir=sessions_dir)

    def delete_empty_sessions(self, sessions_dir: Optional[Path] = None, **kwargs) -> Dict[str, Any]:
        rows = self._conn.execute(
            """
            SELECT s.id FROM sessions s
            WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id)
            """
        ).fetchall()
        return self.delete_sessions([row["id"] for row in rows], sessions_dir=sessions_dir)

    def get_meta(self, key: str) -> Optional[str]:
        row = self._conn.execute("SELECT value FROM state_meta WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def set_meta(self, key: str, value: str) -> None:
        self._conn.execute(
            """
            INSERT INTO state_meta (key, value) VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """,
            (key, value),
        )
        self._conn.commit()

    def try_acquire_compression_lock(self, session_id: str, holder: str, ttl_seconds: float = 300.0) -> bool:
        now = _now()
        self._conn.execute("DELETE FROM compression_locks WHERE session_id = ? AND expires_at < ?", (session_id, now))
        self._conn.execute(
            """
            INSERT INTO compression_locks (session_id, holder, acquired_at, expires_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (session_id) DO NOTHING
            """,
            (session_id, holder, now, now + ttl_seconds),
        )
        row = self._conn.execute("SELECT holder FROM compression_locks WHERE session_id = ?", (session_id,)).fetchone()
        self._conn.commit()
        return bool(row and row["holder"] == holder)

    def release_compression_lock(self, session_id: str, holder: str) -> None:
        self._conn.execute("DELETE FROM compression_locks WHERE session_id = ? AND holder = ?", (session_id, holder))
        self._conn.commit()

    def get_compression_lock_holder(self, session_id: str) -> Optional[str]:
        row = self._conn.execute("SELECT holder FROM compression_locks WHERE session_id = ? AND expires_at >= ?", (session_id, _now())).fetchone()
        return row["holder"] if row else None

    def request_handoff(self, session_id: str, platform: str) -> bool:
        cur = self._conn.execute(
            "UPDATE sessions SET handoff_state = 'pending', handoff_platform = ?, handoff_error = NULL WHERE id = ?",
            (platform, session_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def get_handoff_state(self, session_id: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute(
            "SELECT handoff_state, handoff_platform, handoff_error FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        return dict(row) if row else None

    def list_pending_handoffs(self) -> List[Dict[str, Any]]:
        rows = self._conn.execute("SELECT * FROM sessions WHERE handoff_state = 'pending' ORDER BY started_at ASC").fetchall()
        return [dict(row) for row in rows]

    def export_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        session = self.get_session(session_id)
        if not session:
            return None
        return {"session": session, "messages": self.get_messages(session_id, active_only=False)}

    def export_all(self, source: str = None) -> List[Dict[str, Any]]:
        return [self.export_session(row["id"]) for row in self.list_sessions_rich(source=source, include_archived=True, limit=100000)]

    def optimize_fts(self) -> int:
        return 0

    def vacuum(self) -> int:
        return 0

    def maybe_auto_prune_and_vacuum(self, *args, **kwargs) -> Dict[str, Any]:
        return {"pruned": 0, "vacuumed": False}

