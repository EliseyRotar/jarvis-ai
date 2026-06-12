"""Task scheduler — run a saved prompt on a schedule, even when you're away.

Persists scheduled jobs to ~/.jarvis/scheduler.db and runs a background poll
loop that fires due jobs by handing their prompt to JARVIS as if the operator
had typed it. Supports three schedule kinds, all dependency-free (no croniter):

  - once      : run a single time at an absolute ISO timestamp
  - interval  : run every N seconds (e.g. every 30 min)
  - daily     : run every day at HH:MM local time (e.g. a 6am morning brief)

Inspired by OpenJarvis's TaskScheduler, trimmed to what a personal assistant
actually needs.
"""
from __future__ import annotations

import asyncio
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable

_DIR = os.path.expanduser("~/.jarvis")
DB_PATH = os.path.join(_DIR, "scheduler.db")

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None
_poll_task: asyncio.Task | None = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    os.makedirs(_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS jobs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT,
            prompt      TEXT,
            kind        TEXT,           -- once | interval | daily
            spec        TEXT,           -- iso ts | seconds | HH:MM
            next_run    REAL,
            enabled     INTEGER DEFAULT 1,
            created     REAL,
            last_run    REAL,
            last_result TEXT,
            runs        INTEGER DEFAULT 0
        )"""
    )
    conn.commit()
    _conn = conn
    return conn


# ── schedule math ──────────────────────────────────────────────────────────

def _compute_next(kind: str, spec: str, *, after: float | None = None) -> float:
    """Return the next epoch time this job should fire."""
    now = after if after is not None else time.time()
    if kind == "interval":
        return now + max(5.0, float(spec))
    if kind == "daily":
        hh, mm = (int(x) for x in spec.split(":"))
        base = datetime.fromtimestamp(now)
        target = base.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if target.timestamp() <= now:
            target = target + timedelta(days=1)
        return target.timestamp()
    if kind == "once":
        # spec is an ISO timestamp or epoch seconds
        try:
            return datetime.fromisoformat(spec).timestamp()
        except ValueError:
            return float(spec)
    raise ValueError(f"unknown schedule kind: {kind!r}")


def _row(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    if d.get("next_run"):
        d["next_run_iso"] = datetime.fromtimestamp(d["next_run"]).isoformat(timespec="minutes")
    return d


# ── public CRUD (sync — called from tool dispatch via asyncio.to_thread-free) ─

def add(name: str, prompt: str, kind: str, spec: str) -> dict[str, Any]:
    if kind not in ("once", "interval", "daily"):
        return {"ok": False, "error": "kind must be once | interval | daily"}
    if not prompt:
        return {"ok": False, "error": "prompt is required"}
    try:
        next_run = _compute_next(kind, spec)
    except (ValueError, TypeError) as exc:
        return {"ok": False, "error": f"bad spec: {exc}"}
    with _lock:
        conn = _connect()
        cur = conn.execute(
            "INSERT INTO jobs(name, prompt, kind, spec, next_run, enabled, created) "
            "VALUES (?,?,?,?,?,1,?)",
            (name or prompt[:40], prompt, kind, str(spec), next_run, time.time()),
        )
        conn.commit()
        job_id = cur.lastrowid
    return {"ok": True, "id": job_id,
            "next_run": datetime.fromtimestamp(next_run).isoformat(timespec="minutes")}


def list_jobs(include_disabled: bool = True) -> dict[str, Any]:
    with _lock:
        conn = _connect()
        q = "SELECT * FROM jobs" + ("" if include_disabled else " WHERE enabled=1")
        rows = conn.execute(q + " ORDER BY next_run", ()).fetchall()
    return {"ok": True, "jobs": [_row(r) for r in rows]}


def cancel(job_id: int) -> dict[str, Any]:
    with _lock:
        conn = _connect()
        cur = conn.execute("DELETE FROM jobs WHERE id=?", (job_id,))
        conn.commit()
    if cur.rowcount == 0:
        return {"ok": False, "error": f"no job with id {job_id}"}
    return {"ok": True, "cancelled": job_id}


def set_enabled(job_id: int, enabled: bool) -> dict[str, Any]:
    with _lock:
        conn = _connect()
        cur = conn.execute("UPDATE jobs SET enabled=? WHERE id=?", (int(enabled), job_id))
        conn.commit()
    if cur.rowcount == 0:
        return {"ok": False, "error": f"no job with id {job_id}"}
    return {"ok": True, "id": job_id, "enabled": enabled}


def _due_jobs() -> list[dict[str, Any]]:
    now = time.time()
    with _lock:
        conn = _connect()
        rows = conn.execute(
            "SELECT * FROM jobs WHERE enabled=1 AND next_run <= ? ORDER BY next_run",
            (now,),
        ).fetchall()
        return [dict(r) for r in rows]


def _mark_ran(job: dict[str, Any], result_preview: str) -> None:
    now = time.time()
    with _lock:
        conn = _connect()
        if job["kind"] == "once":
            conn.execute("DELETE FROM jobs WHERE id=?", (job["id"],))
        else:
            nxt = _compute_next(job["kind"], job["spec"], after=now)
            conn.execute(
                "UPDATE jobs SET next_run=?, last_run=?, last_result=?, runs=runs+1 WHERE id=?",
                (nxt, now, result_preview[:500], job["id"]),
            )
        conn.commit()


# ── background loop ─────────────────────────────────────────────────────────

async def run_loop(fire: Callable[[str], Awaitable[Any]], *, poll_seconds: float = 20.0) -> None:
    """Poll for due jobs and invoke *fire(prompt)* for each. Runs forever."""
    _connect()  # ensure schema before first poll
    while True:
        try:
            for job in _due_jobs():
                try:
                    await fire(job["prompt"])
                    _mark_ran(job, "fired")
                except Exception as exc:  # one bad job shouldn't kill the loop
                    _mark_ran(job, f"error: {exc}")
        except asyncio.CancelledError:
            return
        except Exception:
            pass
        await asyncio.sleep(poll_seconds)
