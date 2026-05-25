"""Web search + page fetch.

Uses SearXNG (local) if SEARX_URL is set, otherwise Brave Search API
(if BRAVE_API_KEY is set), otherwise falls back to DuckDuckGo HTML scraping.
"""
from __future__ import annotations

import os
import re
from html import unescape
from typing import Any

import aiohttp


async def search(query: str, max_results: int = 5) -> dict[str, Any]:
    """Search the web. Returns {"results": [{title, url, snippet}, ...]}."""
    if not query.strip():
        return {"ok": False, "error": "empty query", "results": []}

    searx_url = os.environ.get("SEARX_URL")
    brave_key = os.environ.get("BRAVE_API_KEY")

    try:
        if searx_url:
            return await _search_searxng(searx_url, query, max_results)
        if brave_key:
            return await _search_brave(brave_key, query, max_results)
        return await _search_duckduckgo(query, max_results)
    except Exception as exc:
        return {"ok": False, "error": str(exc), "results": []}


async def _search_searxng(base: str, query: str, max_results: int) -> dict[str, Any]:
    params = {"q": query, "format": "json", "safesearch": "0"}
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as sess:
        async with sess.get(base.rstrip("/") + "/search", params=params) as r:
            data = await r.json()
    results = []
    for item in (data.get("results") or [])[:max_results]:
        results.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("content", ""),
        })
    return {"ok": True, "engine": "searxng", "results": results}


async def _search_brave(api_key: str, query: str, max_results: int) -> dict[str, Any]:
    headers = {"X-Subscription-Token": api_key, "Accept": "application/json"}
    params = {"q": query, "count": str(max_results)}
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as sess:
        async with sess.get("https://api.search.brave.com/res/v1/web/search",
                            headers=headers, params=params) as r:
            data = await r.json()
    items = (data.get("web", {}) or {}).get("results", []) or []
    results = []
    for item in items[:max_results]:
        results.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("description", ""),
        })
    return {"ok": True, "engine": "brave", "results": results}


_DDG_RESULT_RE = re.compile(
    r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?'
    r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
    re.DOTALL,
)
_TAG_RE = re.compile(r"<[^>]+>")


async def _search_duckduckgo(query: str, max_results: int) -> dict[str, Any]:
    timeout = aiohttp.ClientTimeout(total=15)
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) JARVIS/1.0"}
    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as sess:
        async with sess.post("https://html.duckduckgo.com/html/",
                             data={"q": query}) as r:
            html = await r.text()
    results = []
    for m in _DDG_RESULT_RE.finditer(html):
        url, title, snippet = m.group(1), m.group(2), m.group(3)
        results.append({
            "title": unescape(_TAG_RE.sub("", title)).strip(),
            "url": unescape(url),
            "snippet": unescape(_TAG_RE.sub("", snippet)).strip(),
        })
        if len(results) >= max_results:
            break
    return {"ok": True, "engine": "duckduckgo", "results": results}


async def fetch(url: str) -> dict[str, Any]:
    """Fetch and extract text content from a URL."""
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "url must start with http(s)://", "text": "", "status": 0}
    timeout = aiohttp.ClientTimeout(total=20)
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) JARVIS/1.0"}
    try:
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as sess:
            async with sess.get(url) as r:
                status = r.status
                ctype = r.headers.get("Content-Type", "")
                raw = await r.text(errors="replace")
    except Exception as exc:
        return {"ok": False, "error": str(exc), "text": "", "status": 0}

    text = raw
    if "html" in ctype.lower():
        # crude HTML → text extraction
        text = re.sub(r"<script[\s\S]*?</script>", "", raw, flags=re.IGNORECASE)
        text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.IGNORECASE)
        text = _TAG_RE.sub(" ", text)
        text = unescape(text)
        text = re.sub(r"\s+", " ", text).strip()
    if len(text) > 20_000:
        text = text[:20_000] + "\n... [truncated]"
    return {"ok": True, "status": status, "url": url, "text": text}
