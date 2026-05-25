"""Long-term memory store backed by ~/.jarvis/memory.json with fuzzy recall."""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from difflib import SequenceMatcher
from typing import Any


STORE_PATH = os.path.expanduser("~/.jarvis/memory.json")
_lock = asyncio.Lock()


def _ensure_store() -> dict[str, Any]:
    if not os.path.exists(STORE_PATH):
        os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
        with open(STORE_PATH, "w", encoding="utf-8") as f:
            json.dump({"entries": []}, f)
    try:
        with open(STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        data = {"entries": []}
    if "entries" not in data:
        data["entries"] = []
    return data


def _save_store(data: dict[str, Any]) -> None:
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, STORE_PATH)


async def save(key: str, value: Any, tags: list[str] | None = None) -> dict[str, Any]:
    """Save or upsert a memory entry by key."""
    if not key:
        return {"ok": False, "error": "key is required"}
    async with _lock:
        data = _ensure_store()
        entries = data["entries"]
        now = time.time()
        for entry in entries:
            if entry.get("key") == key:
                entry["value"] = value
                entry["tags"] = list({*(entry.get("tags") or []), *(tags or [])})
                entry["updated"] = now
                _save_store(data)
                return {"ok": True, "updated": True, "key": key}
        entries.append({
            "key": key,
            "value": value,
            "tags": tags or [],
            "created": now,
            "updated": now,
        })
        _save_store(data)
        return {"ok": True, "updated": False, "key": key}


def _score(query: str, entry: dict[str, Any]) -> float:
    q = query.lower()
    haystack_parts = [str(entry.get("key", "")), *map(str, entry.get("tags", []) or [])]
    value = entry.get("value")
    if isinstance(value, str):
        haystack_parts.append(value)
    elif value is not None:
        try:
            haystack_parts.append(json.dumps(value, ensure_ascii=False))
        except Exception:
            haystack_parts.append(str(value))
    haystack = " ".join(haystack_parts).lower()

    score = 0.0
    # exact substring boost
    for token in re.findall(r"\w+", q):
        if token and token in haystack:
            score += 1.0
    # fuzzy similarity
    score += SequenceMatcher(None, q, haystack[:512]).ratio() * 2.0
    return score


async def recall(query: str, limit: int = 5) -> dict[str, Any]:
    """Recall memories that fuzzy-match query (by key, tag, or value text)."""
    if not query:
        return {"ok": True, "matches": []}
    async with _lock:
        data = _ensure_store()
        entries = list(data["entries"])
    ranked = sorted(
        ((entry, _score(query, entry)) for entry in entries),
        key=lambda p: p[1],
        reverse=True,
    )
    matches = []
    for entry, score in ranked[:limit]:
        if score <= 0.3:
            continue
        matches.append({
            "key": entry.get("key"),
            "value": entry.get("value"),
            "tags": entry.get("tags", []),
            "timestamp": entry.get("updated") or entry.get("created"),
            "score": round(score, 3),
        })
    return {"ok": True, "matches": matches}


async def all_entries() -> list[dict[str, Any]]:
    async with _lock:
        data = _ensure_store()
        return list(data["entries"])


async def list_memories(limit: int = 20) -> dict[str, Any]:
    """Return the most-recently-updated memories."""
    entries = await all_entries()
    entries.sort(key=lambda e: e.get("updated") or e.get("created") or 0, reverse=True)
    return {"ok": True, "count": len(entries), "memories": entries[:limit]}


async def delete(key: str) -> dict[str, Any]:
    """Delete a memory entry by exact key."""
    if not key:
        return {"ok": False, "error": "key is required"}
    async with _lock:
        data = _ensure_store()
        before = len(data["entries"])
        data["entries"] = [e for e in data["entries"] if e.get("key") != key]
        if len(data["entries"]) == before:
            return {"ok": False, "error": f"key not found: {key}"}
        _save_store(data)
    return {"ok": True, "deleted": key}
