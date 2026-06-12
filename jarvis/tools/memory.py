"""Long-term memory backed by SQLite + FTS5 full-text search.

Upgraded from the old difflib/JSON store: real BM25-ranked full-text search
over keys, tags, and values, with document chunking-free whole-entry indexing.
The public async API (save / recall / list_memories / delete / all_entries) is
unchanged, so llm.py and main.py keep working without edits.

On first run, any legacy ~/.jarvis/memory.json is migrated into the database.
If the SQLite build lacks FTS5 (rare), we fall back to a LIKE-based scan so the
feature still works, just without BM25 ranking.
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import time
from typing import Any

_DIR = os.path.expanduser("~/.jarvis")
DB_PATH = os.path.join(_DIR, "memory.db")
_LEGACY_JSON = os.path.join(_DIR, "memory.json")

_lock = asyncio.Lock()
_conn: sqlite3.Connection | None = None
_has_fts = False


# ── connection / schema ───────────────────────────────────────────────────

def _detect_fts5(conn: sqlite3.Connection) -> bool:
    try:
        conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(x)")
        conn.execute("DROP TABLE IF EXISTS _fts_probe")
        return True
    except sqlite3.OperationalError:
        return False


def _connect() -> sqlite3.Connection:
    global _conn, _has_fts
    if _conn is not None:
        return _conn
    os.makedirs(_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS entries (
            key       TEXT PRIMARY KEY,
            value     TEXT,
            tags      TEXT,
            search    TEXT,
            created   REAL,
            updated   REAL
        )"""
    )
    _has_fts = _detect_fts5(conn)
    if _has_fts:
        # External-content FTS5 table mirroring `entries` via triggers.
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts "
            "USING fts5(key, tags, search, content='entries', content_rowid='rowid')"
        )
        conn.executescript(
            """
            CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
              INSERT INTO entries_fts(rowid, key, tags, search)
              VALUES (new.rowid, new.key, new.tags, new.search);
            END;
            CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
              INSERT INTO entries_fts(entries_fts, rowid, key, tags, search)
              VALUES('delete', old.rowid, old.key, old.tags, old.search);
            END;
            CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
              INSERT INTO entries_fts(entries_fts, rowid, key, tags, search)
              VALUES('delete', old.rowid, old.key, old.tags, old.search);
              INSERT INTO entries_fts(rowid, key, tags, search)
              VALUES (new.rowid, new.key, new.tags, new.search);
            END;
            """
        )
    conn.commit()
    _conn = conn
    _migrate_legacy_json(conn)
    return conn


def _migrate_legacy_json(conn: sqlite3.Connection) -> None:
    """One-time import of the old memory.json into the DB."""
    if not os.path.exists(_LEGACY_JSON):
        return
    already = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
    if already:
        # DB already populated — just retire the legacy file.
        _retire_legacy()
        return
    try:
        with open(_LEGACY_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return
    for e in data.get("entries", []):
        key = e.get("key")
        if not key:
            continue
        value = e.get("value")
        tags = e.get("tags") or []
        now = e.get("updated") or e.get("created") or time.time()
        conn.execute(
            "INSERT OR REPLACE INTO entries(key, value, tags, search, created, updated) "
            "VALUES (?,?,?,?,?,?)",
            (key, json.dumps(value, ensure_ascii=False), json.dumps(tags),
             _search_text(key, value, tags), e.get("created") or now, now),
        )
    conn.commit()
    _retire_legacy()


def _retire_legacy() -> None:
    # os.replace overwrites an existing .migrated (unlike os.rename on Windows),
    # so the legacy file never lingers to be re-checked on every startup.
    try:
        os.replace(_LEGACY_JSON, _LEGACY_JSON + ".migrated")
    except OSError:
        pass


def _search_text(key: str, value: Any, tags: list[str] | None) -> str:
    parts = [str(key)]
    if tags:
        parts.extend(str(t) for t in tags)
    if isinstance(value, str):
        parts.append(value)
    elif value is not None:
        try:
            parts.append(json.dumps(value, ensure_ascii=False))
        except (TypeError, ValueError):
            parts.append(str(value))
    return " ".join(parts)


def _row_to_entry(row: sqlite3.Row) -> dict[str, Any]:
    try:
        value = json.loads(row["value"]) if row["value"] is not None else None
    except (json.JSONDecodeError, TypeError):
        value = row["value"]
    try:
        tags = json.loads(row["tags"]) if row["tags"] else []
    except (json.JSONDecodeError, TypeError):
        tags = []
    return {
        "key": row["key"],
        "value": value,
        "tags": tags,
        "created": row["created"],
        "updated": row["updated"],
    }


# ── FTS query helpers ──────────────────────────────────────────────────────

def _fts_query(query: str) -> str:
    """Turn a free-text query into a safe FTS5 MATCH expression (OR of terms)."""
    import re
    terms = re.findall(r"\w+", query.lower())
    if not terms:
        return ""
    # Quote each term and OR them so partial matches still rank.
    return " OR ".join(f'"{t}"' for t in terms)


# ── public async API (unchanged signatures) ────────────────────────────────

async def save(key: str, value: Any, tags: list[str] | None = None) -> dict[str, Any]:
    """Save or upsert a memory entry by key."""
    if not key:
        return {"ok": False, "error": "key is required"}
    async with _lock:
        conn = _connect()
        now = time.time()
        existing = conn.execute("SELECT tags, created FROM entries WHERE key=?", (key,)).fetchone()
        merged_tags = list(tags or [])
        created = now
        updated_flag = False
        if existing is not None:
            updated_flag = True
            created = existing["created"]
            try:
                old_tags = json.loads(existing["tags"]) if existing["tags"] else []
            except (json.JSONDecodeError, TypeError):
                old_tags = []
            merged_tags = list({*old_tags, *(tags or [])})
        conn.execute(
            "INSERT OR REPLACE INTO entries(key, value, tags, search, created, updated) "
            "VALUES (?,?,?,?,?,?)",
            (key, json.dumps(value, ensure_ascii=False), json.dumps(merged_tags),
             _search_text(key, value, merged_tags), created, now),
        )
        conn.commit()
        return {"ok": True, "updated": updated_flag, "key": key}


async def recall(query: str, limit: int = 5) -> dict[str, Any]:
    """Recall memories matching *query* via BM25 full-text search."""
    if not query:
        return {"ok": True, "matches": []}
    async with _lock:
        conn = _connect()
        matches: list[dict[str, Any]] = []
        if _has_fts:
            match_expr = _fts_query(query)
            if match_expr:
                rows = conn.execute(
                    "SELECT e.*, bm25(entries_fts) AS rank "
                    "FROM entries_fts JOIN entries e ON e.rowid = entries_fts.rowid "
                    "WHERE entries_fts MATCH ? ORDER BY rank LIMIT ?",
                    (match_expr, limit),
                ).fetchall()
                for row in rows:
                    entry = _row_to_entry(row)
                    # bm25() returns lower = better (and is negative); flip to a friendly score.
                    entry["score"] = round(-float(row["rank"]), 3)
                    entry["timestamp"] = entry["updated"] or entry["created"]
                    matches.append(entry)
        if not matches and not _has_fts:
            like = f"%{query.lower()}%"
            rows = conn.execute(
                "SELECT * FROM entries WHERE lower(search) LIKE ? "
                "ORDER BY updated DESC LIMIT ?",
                (like, limit),
            ).fetchall()
            for row in rows:
                entry = _row_to_entry(row)
                entry["score"] = 1.0
                entry["timestamp"] = entry["updated"] or entry["created"]
                matches.append(entry)
        return {"ok": True, "matches": matches}


async def all_entries() -> list[dict[str, Any]]:
    async with _lock:
        conn = _connect()
        rows = conn.execute("SELECT * FROM entries ORDER BY updated DESC").fetchall()
        return [_row_to_entry(r) for r in rows]


async def list_memories(limit: int = 20) -> dict[str, Any]:
    """Return the most-recently-updated memories."""
    async with _lock:
        conn = _connect()
        total = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        rows = conn.execute(
            "SELECT * FROM entries ORDER BY updated DESC LIMIT ?", (limit,)
        ).fetchall()
        return {"ok": True, "count": total, "memories": [_row_to_entry(r) for r in rows]}


async def delete(key: str) -> dict[str, Any]:
    """Delete a memory entry by exact key."""
    if not key:
        return {"ok": False, "error": "key is required"}
    async with _lock:
        conn = _connect()
        cur = conn.execute("DELETE FROM entries WHERE key=?", (key,))
        conn.commit()
        if cur.rowcount == 0:
            return {"ok": False, "error": f"key not found: {key}"}
    return {"ok": True, "deleted": key}


# ── sync helper for system-prompt injection (main.py) ──────────────────────

def recent_sync(limit: int = 8) -> list[dict[str, Any]]:
    """Synchronously fetch the most recent entries (used at prompt-load time)."""
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM entries ORDER BY updated DESC LIMIT ?", (limit,)
    ).fetchall()
    return [_row_to_entry(r) for r in rows]
