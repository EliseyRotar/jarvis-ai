"""Security audit log + secret scanning.

JARVIS runs with full, unsandboxed system access, so every tool call is recorded
to an append-only SQLite audit log at ~/.jarvis/audit.db. A lightweight secret
scanner redacts obvious credentials (API keys, tokens, private keys) before any
argument or result text is written to the log, so the audit trail itself never
becomes a place secrets leak to.

Inspired by OpenJarvis's SecretScanner/PIIScanner + AuditLogger, trimmed to a
dependency-free, single-file implementation.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
from typing import Any

_DIR = os.path.expanduser("~/.jarvis")
DB_PATH = os.path.join(_DIR, "audit.db")

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

# ── secret patterns (pattern, label) ──────────────────────────────────────
_SECRET_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"sk-ant-[a-zA-Z0-9_-]{16,}"), "anthropic_key"),
    (re.compile(r"sk-or-[a-zA-Z0-9_-]{16,}"), "openrouter_key"),
    (re.compile(r"sk-[a-zA-Z0-9]{32,}"), "openai_key"),
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}"), "github_token"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), "slack_token"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "aws_access_key"),
    (re.compile(r"AIza[0-9A-Za-z_-]{35}"), "google_api_key"),
    (re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"), "private_key"),
    (re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"), "jwt"),
    (re.compile(r"(?i)(?:password|passwd|secret|api[_-]?key|token)\s*[=:]\s*['\"]?([^\s'\"]{6,})"),
     "credential_assignment"),
]


def scan_secrets(text: str) -> list[str]:
    """Return the labels of any secret patterns found in *text*."""
    found: list[str] = []
    for pattern, label in _SECRET_PATTERNS:
        if pattern.search(text):
            found.append(label)
    return found


def redact(text: str) -> str:
    """Replace any detected secrets with a [REDACTED:label] marker."""
    for pattern, label in _SECRET_PATTERNS:
        text = pattern.sub(f"[REDACTED:{label}]", text)
    return text


# ── store ──────────────────────────────────────────────────────────────────

def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    os.makedirs(_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS audit (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp  REAL,
            tool       TEXT,
            args       TEXT,
            ok         INTEGER,
            error      TEXT,
            secrets    TEXT,
            duration   REAL
        )"""
    )
    conn.commit()
    _conn = conn
    return conn


def _preview(value: Any, limit: int = 600) -> str:
    try:
        s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        s = str(value)
    if len(s) > limit:
        s = s[:limit] + "…"
    return redact(s)


def record(tool: str, args: dict[str, Any], result: dict[str, Any], duration: float = 0.0) -> None:
    """Append one tool invocation to the audit log (secrets redacted)."""
    try:
        raw_args = json.dumps(args, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        raw_args = str(args)
    secrets = sorted(set(scan_secrets(raw_args) + scan_secrets(json.dumps(result, default=str))))
    ok = bool(result.get("ok", True)) if isinstance(result, dict) else True
    error = (result.get("error") if isinstance(result, dict) else None) or ""
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO audit(timestamp, tool, args, ok, error, secrets, duration) "
            "VALUES (?,?,?,?,?,?,?)",
            (time.time(), tool, _preview(args), int(ok), redact(str(error)),
             ",".join(secrets), round(duration, 4)),
        )
        conn.commit()


def recent(limit: int = 50, tool: str | None = None) -> list[dict[str, Any]]:
    """Return the most recent audit entries (newest first)."""
    with _lock:
        conn = _connect()
        if tool:
            rows = conn.execute(
                "SELECT * FROM audit WHERE tool=? ORDER BY id DESC LIMIT ?", (tool, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        cols = ["id", "timestamp", "tool", "args", "ok", "error", "secrets", "duration"]
        return [dict(zip(cols, r)) for r in rows]


def summary() -> dict[str, Any]:
    """Aggregate stats over the whole audit log."""
    with _lock:
        conn = _connect()
        total = conn.execute("SELECT COUNT(*) FROM audit").fetchone()[0]
        failures = conn.execute("SELECT COUNT(*) FROM audit WHERE ok=0").fetchone()[0]
        with_secrets = conn.execute(
            "SELECT COUNT(*) FROM audit WHERE secrets != ''"
        ).fetchone()[0]
        by_tool = conn.execute(
            "SELECT tool, COUNT(*) c FROM audit GROUP BY tool ORDER BY c DESC"
        ).fetchall()
    return {
        "total": total,
        "failures": failures,
        "entries_with_secrets": with_secrets,
        "by_tool": {t: c for t, c in by_tool},
    }
