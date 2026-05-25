"""Deep web research: multi-angle search + parallel content extraction."""
from __future__ import annotations

import asyncio
from typing import Any

from . import web_search

_ANGLES = [
    "{q}",
    "{q} in depth analysis",
    "{q} 2024 2025 latest",
    "{q} research study guide",
]


async def research(query: str, max_sources: int = 10) -> dict[str, Any]:
    """Search multiple query angles in parallel, fetch and compile top sources.

    Returns a structured dict with all source titles, URLs, snippets and
    extracted page content ready for the LLM to synthesise.
    """
    if not query.strip():
        return {"ok": False, "error": "empty query"}

    angles = [a.replace("{q}", query.strip()) for a in _ANGLES]

    # 1. Search all angles in parallel
    search_results = await asyncio.gather(
        *[web_search.search(a, max_results=6) for a in angles],
        return_exceptions=True,
    )

    # 2. Deduplicate by URL (preserve first-seen order)
    seen: set[str] = set()
    candidates: list[dict[str, Any]] = []
    for res in search_results:
        if isinstance(res, Exception):
            continue
        for item in res.get("results", []):
            url = item.get("url", "")
            if url and url not in seen:
                seen.add(url)
                candidates.append(item)

    # 3. Fetch content from top unique sources in parallel
    to_fetch = candidates[:max_sources]
    fetched = await asyncio.gather(
        *[web_search.fetch(item["url"]) for item in to_fetch],
        return_exceptions=True,
    )

    sources: list[dict[str, Any]] = []
    for item, result in zip(to_fetch, fetched):
        if isinstance(result, Exception) or not result.get("ok"):
            continue
        content = result.get("text", "")
        if len(content) < 80:
            continue
        sources.append({
            "title":   item.get("title", ""),
            "url":     item.get("url", ""),
            "snippet": item.get("snippet", ""),
            "content": content[:5000],
        })

    return {
        "ok":               True,
        "query":            query,
        "angles_searched":  len(angles),
        "candidates_found": len(candidates),
        "sources_fetched":  len(sources),
        "sources":          sources,
    }
