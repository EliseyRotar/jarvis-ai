"""Single long-term memory brain — mem0 OSS, 100% local.

Replaces ~/.jarvis/memory.db (migrated then retired). Everything runs on
this PC:

- extraction LLM: local Ollama (big Qwen by default — override with
  JARVIS_MEMORY_LLM)
- embeddings: local Ollama nomic-embed-text (768 dims)
- vectors: qdrant local mode at ~/.jarvis/mem0_qdrant

Consumers:

- Cosmo  → jarvis-memory MCP server (mcp_memory.py, mounted at /mcp)
- UI     → REST /api/memory* (list/search/add/delete/graph)
- prompt → _memory_context_block() injects the most recent facts each turn
- ingest → ingest_turn() runs LLM fact extraction after every reply
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from typing import Any

log = logging.getLogger("jarvis.memory")

_DIR = os.path.expanduser("~/.jarvis")
OLLAMA_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
LLM_MODEL = os.environ.get(
    "JARVIS_MEMORY_LLM", "orcarouter/Qwen3.8-27B-Uncensored:iq4_XS"
)
EMBED_MODEL = os.environ.get("JARVIS_MEMORY_EMBED", "nomic-embed-text")
COLLECTION = "jarvis_memory"
USER_ID = "eli6"

_init_lock = threading.Lock()
_mem: Any = None
_init_failed = False


def _get() -> Any:
    """Lazily construct the mem0 Memory singleton (blocking, thread-safe)."""
    global _mem, _init_failed
    if _mem is not None:
        return _mem
    if _init_failed:
        return None
    with _init_lock:
        if _mem is not None:
            return _mem
        try:
            from mem0 import Memory

            config = {
                "llm": {
                    "provider": "ollama",
                    "config": {
                        "model": LLM_MODEL,
                        "ollama_base_url": OLLAMA_URL,
                        "temperature": 0.1,
                        "max_tokens": 1500,
                    },
                },
                "embedder": {
                    "provider": "ollama",
                    "config": {
                        "model": EMBED_MODEL,
                        "ollama_base_url": OLLAMA_URL,
                    },
                },
                "vector_store": {
                    "provider": "qdrant",
                    "config": {
                        "path": os.path.join(_DIR, "mem0_qdrant"),
                        "collection_name": COLLECTION,
                        # nomic-embed-text = 768 dims (mem0 defaults to
                        # 1536 / OpenAI and would mismatch the collection)
                        "embedding_model_dims": 768,
                    },
                },
            }
            _mem = Memory.from_config(config)
            log.info("mem0 brain ready (llm=%s embedder=%s)", LLM_MODEL, EMBED_MODEL)
        except Exception:
            _init_failed = True
            log.exception("mem0 init failed — memory features degraded")
            return None
        return _mem


def _results(payload: Any) -> list[dict[str, Any]]:
    """mem0 returns either a list or {"results": [...]} depending on version."""
    if payload is None:
        return []
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        rows = payload.get("results")
        if isinstance(rows, list):
            return [r for r in rows if isinstance(r, dict)]
    return []


def _shape(row: dict[str, Any]) -> dict[str, Any]:
    meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    return {
        "id": row.get("id"),
        "text": row.get("memory") or row.get("text") or "",
        "tags": meta.get("tags") or [],
        "created": row.get("created_at") or row.get("created") or "",
        "updated": row.get("updated_at") or row.get("updated") or "",
        "score": row.get("score"),
        "metadata": meta,
    }


def _err(exc: Exception) -> dict[str, Any]:
    log.warning("memory operation failed: %s", exc)
    return {"ok": False, "error": str(exc)[:300]}


# ── public async API ──────────────────────────────────────────────────────


async def search(query: str, limit: int = 6) -> dict[str, Any]:
    if not query.strip():
        return {"ok": True, "results": []}

    def _run() -> dict[str, Any]:
        m = _get()
        if m is None:
            return {"ok": False, "error": "memory backend unavailable"}
        # mem0 2.x: entity scoping lives in filters=, size in top_k=
        rows = _results(
            m.search(query, top_k=limit, filters={"user_id": USER_ID})
        )
        return {"ok": True, "results": [_shape(r) for r in rows]}

    try:
        return await asyncio.to_thread(_run)
    except Exception as exc:
        return _err(exc)


async def add_fact(text: str, tags: list[str] | None = None) -> dict[str, Any]:
    """Store one fact verbatim (no LLM extraction) — the memory_add tool path."""
    text = (text or "").strip()
    if not text:
        return {"ok": False, "error": "text is required"}

    def _run() -> dict[str, Any]:
        m = _get()
        if m is None:
            return {"ok": False, "error": "memory backend unavailable"}
        metadata: dict[str, Any] = {"source": "explicit"}
        if tags:
            metadata["tags"] = tags
        rows = _results(
            m.add(
                messages=[{"role": "user", "content": text}],
                user_id=USER_ID,
                metadata=metadata,
                infer=False,
            )
        )
        new_id = rows[0].get("id") if rows else None
        return {"ok": True, "id": new_id, "text": text}

    try:
        return await asyncio.to_thread(_run)
    except Exception as exc:
        return _err(exc)


async def ingest_turn(user_text: str, assistant_text: str) -> dict[str, Any]:
    """Queue one exchange for background fact extraction (returns immediately).

    Extraction deliberately runs OUTSIDE mem0: mem0's infer=True keeps its
    internals busy across the whole local-LLM call (minutes for the 27B), which
    made concurrent memory_search calls time out at 60s, and its default prompt
    produced JSON mem0 could not parse (facts silently dropped). We call Ollama
    ourselves (format=json, think off, strict prompt, coalesced batches), then
    store each fact with mem0 infer=False — embed + upsert only, milliseconds.
    """
    user_text = (user_text or "").strip().removeprefix("[VOICE] ").strip()
    assistant_text = (assistant_text or "").strip()
    if not user_text or not assistant_text:
        return {"ok": False, "error": "empty turn"}
    with _pending_lock:
        _pending.append((user_text, assistant_text))
        queued = len(_pending)
    _ensure_worker()
    return {"ok": True, "queued": queued}


# ── background ingest worker (coalescing, one batch at a time) ──────────
_pending: list[tuple[str, str]] = []
_pending_lock = threading.Lock()
_worker_running = False
_BATCH_MAX = 6
_FACTS_MAX = 20

_EXTRACT_SYS = (
    "You extract durable facts about a user from conversation excerpts.\n"
    'Reply ONLY with a JSON object: {"facts": [{"fact": "...", "tags": ["..."]}]}\n'
    "- fact: one short standalone declarative sentence (preferences, people,\n"
    "  places, projects, decisions, environment/config details worth knowing\n"
    "  weeks later).\n"
    "- tags: 1-5 lowercase kebab-case keywords.\n"
    '- Reply with {"facts": []} for small talk, thanks, one-off requests, or\n'
    "  anything transient. Never invent facts not present in the excerpts."
)


def _ensure_worker() -> None:
    global _worker_running
    with _pending_lock:
        if _worker_running:
            return
        _worker_running = True
    threading.Thread(
        target=_ingest_worker, name="jarvis-memory-ingest", daemon=True
    ).start()


def _ingest_worker() -> None:
    global _worker_running
    try:
        while True:
            with _pending_lock:
                if not _pending:
                    _worker_running = False
                    return
                batch = _pending[:_BATCH_MAX]
                del _pending[:_BATCH_MAX]
            try:
                _extract_and_store(batch)
            except Exception:
                log.exception("ingest batch failed (%d turns)", len(batch))
    except BaseException:
        with _pending_lock:
            _worker_running = False
        raise


def _chat_json(messages: list[dict[str, str]]) -> str:
    """One non-streaming Ollama chat call, JSON-forced, reasoning disabled."""
    import ollama as oai

    client = oai.Client(host=OLLAMA_URL)
    kwargs: dict[str, Any] = dict(
        model=LLM_MODEL,
        messages=messages,
        stream=False,
        format="json",
        options={"temperature": 0.1, "num_predict": 500},
        # Stay resident for 10m: Ollama serializes model LOADS (a cold 17GB
        # load blocks concurrent embeds -> memory_search stalls for ~30s).
        # Reusing the resident model across nearby turns avoids that window.
        keep_alive="10m",
    )
    try:
        resp = client.chat(think=False, **kwargs)
    except TypeError:
        resp = client.chat(**kwargs)  # older ollama lib: no think kwarg
    except Exception as exc:
        if "think" not in str(exc).lower():
            raise
        resp = client.chat(**kwargs)  # model/server rejects think field
    msg = getattr(resp, "message", None)
    content = getattr(msg, "content", None) if msg is not None else None
    if content is None and isinstance(resp, dict):
        content = (resp.get("message") or {}).get("content")
    return content or ""


def _parse_facts(text: str) -> list[dict[str, Any]]:
    """Tolerant JSON-array extraction: direct parse, then brace/bracket salvage."""
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text[:4].lower() in ("json", "json\n"):
            text = text[4:].lstrip()
    obj: Any = None
    try:
        obj = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        for oc, cc in (("{", "}"), ("[", "]")):
            i, j = text.find(oc), text.rfind(cc)
            if i != -1 and j > i:
                try:
                    obj = json.loads(text[i : j + 1])
                    break
                except (json.JSONDecodeError, ValueError):
                    continue
    if obj is None:
        return []
    items = obj
    if isinstance(obj, dict):
        items = obj.get("facts") or obj.get("items") or obj.get("memories") or []
    if isinstance(items, dict):
        items = items.get("facts") or items.get("items") or []
    if not isinstance(items, list):
        return []
    out: list[dict[str, Any]] = []
    for it in items:
        if isinstance(it, str):
            fact, tags = it, []
        elif isinstance(it, dict):
            fact = it.get("fact") or it.get("text") or it.get("memory") or ""
            tags = it.get("tags") or []
        else:
            continue
        fact = str(fact).strip()
        if fact:
            if not isinstance(tags, list):
                tags = [tags] if tags else []
            out.append({"fact": fact, "tags": [str(t) for t in tags][:6]})
    return out[:_FACTS_MAX]


def _extract_and_store(batch: list[tuple[str, str]]) -> None:
    t0 = time.time()
    # Warm the embedder first so nomic stays resident while the 27B runs —
    # keeps concurrent memory_search embeds fast (separate Ollama slots).
    try:
        import ollama as oai

        oai.Client(host=OLLAMA_URL).embed(model=EMBED_MODEL, input="warmup")
    except Exception:
        pass

    excerpts = "\n\n".join(f"USER: {u}\nASSISTANT: {a}" for u, a in batch)
    content = _chat_json(
        [{"role": "system", "content": _EXTRACT_SYS},
         {"role": "user", "content": excerpts}]
    )
    facts = _parse_facts(content)
    if not facts:
        log.info(
            "ingest: %d turn(s) -> 0 facts in %.1fs%s",
            len(batch), time.time() - t0,
            f" raw={content[:120]!r}" if content else "",
        )
        return

    m = _get()
    if m is None:
        log.warning("ingest: memory backend unavailable, dropping %d facts", len(facts))
        return
    stored = 0
    for f in facts:
        meta: dict[str, Any] = {"source": "conversation"}
        if f["tags"]:
            meta["tags"] = f["tags"]
        try:
            rows = _results(
                m.add(
                    messages=[{"role": "user", "content": f["fact"]}],
                    user_id=USER_ID,
                    metadata=meta,
                    infer=False,
                )
            )
            stored += 1 if rows else 0
        except Exception:
            log.warning("fact store failed: %.80s", f["fact"])
    log.info(
        "ingest: %d turn(s) -> %d/%d facts in %.1fs",
        len(batch), stored, len(facts), time.time() - t0,
    )


async def list_memories(limit: int = 200) -> dict[str, Any]:
    def _run() -> dict[str, Any]:
        m = _get()
        if m is None:
            return {"ok": False, "error": "memory backend unavailable"}
        rows = _results(
            m.get_all(filters={"user_id": USER_ID}, top_k=limit)
        )
        shaped = [_shape(r) for r in rows]
        shaped.sort(key=lambda r: str(r.get("updated") or ""), reverse=True)
        return {"ok": True, "count": len(shaped), "memories": shaped}

    try:
        return await asyncio.to_thread(_run)
    except Exception as exc:
        return _err(exc)


async def delete(memory_id: str) -> dict[str, Any]:
    if not memory_id:
        return {"ok": False, "error": "id is required"}

    def _run() -> dict[str, Any]:
        m = _get()
        if m is None:
            return {"ok": False, "error": "memory backend unavailable"}
        m.delete(memory_id)
        return {"ok": True, "deleted": memory_id}

    try:
        return await asyncio.to_thread(_run)
    except Exception as exc:
        return _err(exc)


def recent_facts(limit: int = 8) -> list[dict[str, Any]]:
    """SYNC newest-first facts for system-prompt injection (prompt-load time)."""
    m = _get()
    if m is None:
        return []
    try:
        rows = _results(m.get_all(filters={"user_id": USER_ID}, top_k=max(limit, 20)))
    except Exception as exc:
        log.debug("recent_facts failed: %s", exc)
        return []
    shaped = [_shape(r) for r in rows]
    shaped.sort(key=lambda r: str(r.get("updated") or ""), reverse=True)
    return shaped[:limit]


def _vec_of(point: Any) -> list[float] | None:
    """Pull a flat float vector off a qdrant point (list or named-vector dict)."""
    v = getattr(point, "vector", None)
    if isinstance(v, dict):
        # named vectors: {"default": [...], ...} — pick the longest component
        comps = [c for c in v.values() if isinstance(c, list) and c]
        if not comps:
            return None
        v = max(comps, key=len)
    if not isinstance(v, list) or not v:
        return None
    try:
        return [float(x) for x in v]
    except (TypeError, ValueError):
        return None


def graph(limit: int = 250, top_k: int = 2, min_sim: float = 0.30) -> dict[str, Any]:
    """Connected-memory graph: nodes = memories, edges = cosine neighbours.

    mem0's public get_all() strips vectors, so we scroll the qdrant store
    directly with with_vectors=True (same process, already locked).
    Runs synchronously — callers should asyncio.to_thread from async code.
    """
    m = _get()
    if m is None:
        return {"ok": False, "error": "memory backend unavailable"}
    try:
        vs = m.vector_store
        flt = vs._create_filter({"user_id": USER_ID})
        scrolled = vs.client.scroll(
            collection_name=vs.collection_name,
            scroll_filter=flt,
            limit=max(10, min(limit, 2000)),
            with_payload=True,
            with_vectors=True,
        )
        points = scrolled[0] if isinstance(scrolled, tuple) else scrolled
    except Exception as exc:
        return _err(exc)

    nodes: list[dict[str, Any]] = []
    vectors: list[list[float] | None] = []
    for p in points or []:
        payload = getattr(p, "payload", None) or {}
        meta = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        nodes.append(
            {
                "id": str(getattr(p, "id", "")),
                "text": payload.get("data") or "",
                "tags": meta.get("tags") or payload.get("tags") or [],
                "updated": payload.get("updated_at") or "",
            }
        )
        vectors.append(_vec_of(p))

    edges: list[dict[str, Any]] = []
    seen: set[tuple[int, int]] = set()
    for i, a in enumerate(vectors):
        if not a:
            continue
        scored: list[tuple[float, int]] = []
        na = sum(x * x for x in a) ** 0.5
        if not na:
            continue
        for j, b in enumerate(vectors):
            if i == j or not b or len(a) != len(b):
                continue
            dot = sum(x * y for x, y in zip(a, b))
            nb = sum(y * y for y in b) ** 0.5
            if nb:
                scored.append((dot / (na * nb), j))
        scored.sort(reverse=True)
        added = 0
        for sim, j in scored:
            if sim < min_sim or added >= top_k:
                break
            key = (min(i, j), max(i, j))
            if key in seen:
                continue
            seen.add(key)
            added += 1
            edges.append(
                {"source": nodes[i]["id"], "target": nodes[j]["id"], "sim": round(sim, 3)}
            )
    return {"ok": True, "nodes": nodes, "edges": edges}


async def add_bulk_facts(
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Migration helper: store many verbatim facts (no extraction)."""
    stored = 0

    def _run() -> dict[str, Any]:
        nonlocal stored
        m = _get()
        if m is None:
            return {"ok": False, "error": "memory backend unavailable"}
        for it in items:
            text = (it.get("text") or "").strip()
            if not text:
                continue
            meta = {"source": it.get("source", "migration")}
            if it.get("key"):
                meta["key"] = it["key"]
            if it.get("tags"):
                meta["tags"] = it["tags"]
            m.add(
                messages=[{"role": "user", "content": text}],
                user_id=USER_ID,
                metadata=meta,
                infer=False,
            )
            stored += 1
        return {"ok": True, "stored": stored}

    try:
        return await asyncio.to_thread(_run)
    except Exception as exc:
        return _err(exc)
