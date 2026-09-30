"""jarvis-memory MCP server — Cosmo's window into the single memory brain.

Mounted into the jarvis ASGI app at /mcp (Streamable HTTP, stateless).
Registered on the Hermes gateway side in config.yaml:

    mcp_servers:
      jarvis-memory:
        url: "http://127.0.0.1:8765/mcp"
        skip_preflight: true

Tool results are returned as compact JSON strings so the model can parse
ids for update/delete follow-ups.
"""
from __future__ import annotations

import json
from typing import Any

from mcp.server.fastmcp import FastMCP

from . import memory_store

mcp = FastMCP(
    "jarvis-memory",
    instructions=(
        "Long-term memory for Cosmo. search returns durable facts about the "
        "user and past work; add stores a verbatim fact. Use search at the "
        "start of a task when prior context could matter, and add when the "
        "user shares something worth remembering for later."
    ),
    stateless_http=True,
)


def _dump(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


@mcp.tool()
async def memory_search(query: str, limit: int = 6) -> str:
    """Semantic search over everything Cosmo remembers (facts, project notes, preferences)."""
    limit = max(1, min(int(limit or 6), 25))
    return _dump(await memory_store.search(query, limit=limit))


@mcp.tool()
async def memory_add(text: str, tags: str = "") -> str:
    """Store one fact verbatim in long-term memory. tags: optional comma-separated labels."""
    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()]
    return _dump(await memory_store.add_fact(text, tag_list))


@mcp.tool()
async def memory_list(limit: int = 50) -> str:
    """List the most recently updated memories (newest first)."""
    limit = max(1, min(int(limit or 50), 200))
    return _dump(await memory_store.list_memories(limit=limit))


@mcp.tool()
async def memory_delete(memory_id: str) -> str:
    """Delete one memory by its id (from memory_search or memory_list)."""
    return _dump(await memory_store.delete(memory_id))
