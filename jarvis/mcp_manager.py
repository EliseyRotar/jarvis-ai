"""MCP (Model Context Protocol) client manager.

Connects to all enabled MCP servers from ~/.jarvis/mcp.json on startup,
discovers their tools, and provides unified dispatch — so any LLM backend
(Claude, Ollama, OpenRouter) can call WhatsApp, Gmail, Playwright, ElevenLabs,
Meta Ads, Home Assistant MCP, or any other MCP connector.

Architecture:
  Each server runs in its own asyncio Task that keeps the connection alive
  for the app lifetime.  Tool calls are sent to the task via an asyncio.Queue
  and results returned through asyncio.Future objects so callers just
  `await manager.dispatch(name, args)`.

Native tool names (bash_exec, ha_call_service, …) shadow any MCP tools with
the same name — this avoids accidental overrides of the optimised built-ins.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

log = logging.getLogger("jarvis.mcp")

MCP_CONFIG_PATH = Path.home() / ".jarvis" / "mcp.json"

# ── Native tools that MCP must never shadow ──────────────────────────────────
NATIVE_TOOL_NAMES: frozenset[str] = frozenset({
    "bash_exec", "file_read", "file_write", "file_delete", "hypr_dispatch",
    "web_search", "web_fetch", "memory_save", "memory_recall", "memory_list",
    "memory_delete", "deep_research", "tts_speak", "schedule_add",
    "schedule_list", "schedule_cancel", "audit_log",
    "ha_get_states", "ha_call_service", "ha_search_entities",
    "ha_get_areas", "ha_render_template",
})


# ── Schema conversion helpers ─────────────────────────────────────────────────

def _mcp_tool_to_openai(tool: Any, server_name: str) -> dict[str, Any]:
    """Convert an MCP Tool object to an OpenAI-compatible function schema."""
    params = getattr(tool, "inputSchema", None) or {"type": "object", "properties": {}}
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": f"[{server_name}] {tool.description or ''}",
            "parameters": params,
        },
    }


def _mcp_result_to_dict(result: Any) -> dict[str, Any]:
    """Convert an MCP CallToolResult to a serialisable dict."""
    if result is None:
        return {"ok": True, "result": ""}
    content = getattr(result, "content", None) or []
    parts: list[str] = []
    for block in content:
        text = getattr(block, "text", None)
        if text is not None:
            parts.append(str(text))
        else:
            btype = getattr(block, "type", "unknown")
            parts.append(f"[{btype} content]")
    is_error = getattr(result, "isError", False)
    return {
        "ok": not is_error,
        "result": "\n".join(parts) if parts else "",
    }


# ── Single-server connection ──────────────────────────────────────────────────

class _MCPServer:
    """Manages one MCP server connection (stdio or HTTP/SSE)."""

    def __init__(self, name: str, config: dict[str, Any]) -> None:
        self.name = name
        self.config = config
        self.tools: list[dict[str, Any]] = []   # OpenAI-format schemas
        self._tool_names: set[str] = set()
        self._request_queue: asyncio.Queue = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._ready = asyncio.Event()
        self._error: str | None = None
        self._stopped = False

    # ── Public interface ──────────────────────────────────────────────────────

    @property
    def ok(self) -> bool:
        return self._error is None and not self._stopped

    def has_tool(self, name: str) -> bool:
        return name in self._tool_names

    async def start(self) -> None:
        loop = asyncio.get_event_loop()
        self._task = loop.create_task(self._run(), name=f"mcp:{self.name}")
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=45.0)
        except asyncio.TimeoutError:
            log.warning("[mcp:%s] timed out waiting for ready", self.name)
            self._error = "connection timed out"
        if self._error:
            log.error("[mcp:%s] startup failed: %s", self.name, self._error)
        else:
            log.info("[mcp:%s] ready — %d tools: %s",
                     self.name, len(self.tools), sorted(self._tool_names))

    async def call_tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        if self._error:
            return {"ok": False, "error": f"[mcp:{self.name}] not available: {self._error}"}
        if self._stopped:
            return {"ok": False, "error": f"[mcp:{self.name}] stopped"}
        loop = asyncio.get_event_loop()
        future: asyncio.Future = loop.create_future()
        await self._request_queue.put((future, name, args))
        try:
            return await asyncio.wait_for(asyncio.shield(future), timeout=120.0)
        except asyncio.TimeoutError:
            return {"ok": False, "error": f"[mcp:{self.name}] tool '{name}' timed out after 120s"}

    async def stop(self) -> None:
        self._stopped = True
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await asyncio.wait_for(self._task, timeout=5.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass

    # ── Internal run loop ─────────────────────────────────────────────────────

    async def _run(self) -> None:
        try:
            if self.config.get("type") == "http":
                await self._run_sse()
            else:
                await self._run_stdio()
        except asyncio.CancelledError:
            raise
        except BaseException as exc:
            # Catches both plain Exception AND anyio/Python-3.11+ ExceptionGroup
            # ("unhandled errors in a TaskGroup") that the MCP SDK raises on connect failure.
            msg = str(exc)
            # Unwrap ExceptionGroup to get the first real sub-exception message
            subs = getattr(exc, "exceptions", None)
            if subs:
                msg = "; ".join(str(e) for e in subs[:3])
            if not self._ready.is_set():
                self._error = msg
                self._ready.set()
            log.error("[mcp:%s] connection closed: %s", self.name, msg)

    async def _run_stdio(self) -> None:
        try:
            from mcp.client.stdio import StdioServerParameters, stdio_client
            from mcp.client.session import ClientSession
        except ImportError as exc:
            self._error = f"mcp SDK not installed: {exc}"
            self._ready.set()
            return

        # Build env: filter out empty/None values so they don't shadow inherited vars
        raw_env: dict[str, str] | None = self.config.get("env") or None
        if raw_env:
            filtered = {k: v for k, v in raw_env.items() if v}
            raw_env = filtered or None

        # Merge with current environment so PATH etc. are inherited
        merged_env: dict[str, str] | None = None
        if raw_env:
            merged_env = {**os.environ, **raw_env}

        params = StdioServerParameters(
            command=self.config["command"],
            args=self.config.get("args", []),
            env=merged_env,
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                await self._session_loop(session)

    async def _run_sse(self) -> None:
        try:
            from mcp.client.sse import sse_client
            from mcp.client.session import ClientSession
        except ImportError as exc:
            self._error = f"mcp SDK not installed: {exc}"
            self._ready.set()
            return

        url: str = self.config["url"]
        headers: dict[str, Any] = self.config.get("headers") or {}

        async with sse_client(url, headers=headers, sse_read_timeout=3600) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                await self._session_loop(session)

    async def _session_loop(self, session: Any) -> None:
        """Discover tools, signal ready, then serve call requests indefinitely."""
        # 1. Discover tools
        try:
            tools_result = await session.list_tools()
            raw_tools = getattr(tools_result, "tools", []) or []
            for tool in raw_tools:
                if tool.name in NATIVE_TOOL_NAMES:
                    log.debug("[mcp:%s] skipping '%s' (shadowed by native)", self.name, tool.name)
                    continue
                self.tools.append(_mcp_tool_to_openai(tool, self.name))
                self._tool_names.add(tool.name)
        except Exception as exc:
            self._error = f"list_tools failed: {exc}"
            self._ready.set()
            return
        self._ready.set()

        # 2. Serve requests
        while not self._stopped:
            try:
                item = await asyncio.wait_for(
                    self._request_queue.get(), timeout=1.0
                )
            except asyncio.TimeoutError:
                continue
            future, tool_name, args = item
            try:
                result = await session.call_tool(tool_name, arguments=args or {})
                result_dict = _mcp_result_to_dict(result)
            except Exception as exc:
                result_dict = {"ok": False, "error": str(exc)}
            if not future.done():
                future.set_result(result_dict)


# ── Manager ────────────────────────────────────────────────────────────────────

class MCPManager:
    """Manages all MCP server connections and routes tool calls."""

    def __init__(self) -> None:
        self._servers: dict[str, _MCPServer] = {}

    async def start(self) -> None:
        cfg = _load_config()
        if not cfg:
            log.info("[mcp] no servers in mcp.json — nothing to start")
            return

        enabled = {
            name: srv_cfg
            for name, srv_cfg in cfg.items()
            if srv_cfg.get("enabled", True)
        }
        if not enabled:
            log.info("[mcp] all servers disabled")
            return

        log.info("[mcp] starting %d server(s): %s", len(enabled), list(enabled))
        tasks = []
        for name, srv_cfg in enabled.items():
            server = _MCPServer(name, srv_cfg)
            self._servers[name] = server
            tasks.append(server.start())

        results = await asyncio.gather(*tasks, return_exceptions=True)
        for name, res in zip(enabled, results):
            if isinstance(res, Exception):
                log.error("[mcp] %s start raised: %s", name, res)

        ok = [n for n, s in self._servers.items() if s.ok]
        total_tools = sum(len(s.tools) for s in self._servers.values() if s.ok)
        log.info("[mcp] %d/%d servers healthy, %d total MCP tools",
                 len(ok), len(self._servers), total_tools)

    async def stop(self) -> None:
        await asyncio.gather(
            *[s.stop() for s in self._servers.values()],
            return_exceptions=True,
        )
        self._servers.clear()

    def get_schemas(self) -> list[dict[str, Any]]:
        """All MCP tool schemas in OpenAI format (healthy servers only)."""
        schemas: list[dict[str, Any]] = []
        for server in self._servers.values():
            if server.ok:
                schemas.extend(server.tools)
        return schemas

    def get_tool_names(self) -> list[str]:
        names: list[str] = []
        for server in self._servers.values():
            if server.ok:
                names.extend(server._tool_names)
        return names

    def find_server(self, tool_name: str) -> _MCPServer | None:
        for server in self._servers.values():
            if server.ok and server.has_tool(tool_name):
                return server
        return None

    async def dispatch(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any] | None:
        """Dispatch tool_name to the appropriate server. Returns None if not handled."""
        server = self.find_server(tool_name)
        if server is None:
            return None
        return await server.call_tool(tool_name, args)

    def status(self) -> dict[str, Any]:
        """Return a status dict for /api/mcp/status."""
        return {
            "servers": {
                name: {
                    "ok": s.ok,
                    "error": s._error,
                    "tools": sorted(s._tool_names),
                }
                for name, s in self._servers.items()
            },
            "total_tools": sum(len(s.tools) for s in self._servers.values() if s.ok),
        }


# ── Module-level singleton ────────────────────────────────────────────────────

_manager: MCPManager | None = None


async def start() -> MCPManager:
    """Start the global MCP manager. Called from app lifespan startup."""
    global _manager
    _manager = MCPManager()
    await _manager.start()
    return _manager


async def stop() -> None:
    """Stop the global MCP manager. Called from app lifespan shutdown."""
    global _manager
    if _manager is not None:
        await _manager.stop()
        _manager = None


def get_manager() -> MCPManager | None:
    return _manager


def get_schemas() -> list[dict[str, Any]]:
    """Return all MCP tool schemas (safe to call when manager is None)."""
    return _manager.get_schemas() if _manager is not None else []


async def dispatch(tool_name: str, args: dict[str, Any]) -> dict[str, Any] | None:
    """Route a tool call. Returns None if no MCP server handles this tool."""
    return await _manager.dispatch(tool_name, args) if _manager is not None else None


# ── Config loader ─────────────────────────────────────────────────────────────

def _load_config() -> dict[str, Any]:
    try:
        if MCP_CONFIG_PATH.exists():
            data = json.loads(MCP_CONFIG_PATH.read_text(encoding="utf-8-sig"))
            # Support both flat {"name": {...}, ...} and Claude Code's
            # {"mcpServers": {"name": {...}, ...}, "_comment": "..."} formats
            if isinstance(data, dict) and "mcpServers" in data:
                return data["mcpServers"]
            return {k: v for k, v in data.items() if isinstance(v, dict)}
    except Exception as exc:
        log.warning("[mcp] failed to load %s: %s", MCP_CONFIG_PATH, exc)
    return {}
