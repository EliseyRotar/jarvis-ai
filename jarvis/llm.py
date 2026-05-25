"""LLM dispatch — Claude Agent SDK (primary) + OpenRouter (fallback).

Backend selection:
  - JARVIS_LLM_BACKEND=claude     → force Claude Pro / Agent SDK
  - JARVIS_LLM_BACKEND=openrouter → force OpenRouter
  - JARVIS_LLM_BACKEND=auto       → Claude if CLAUDE_CODE_OAUTH_TOKEN is set,
                                    else OpenRouter if OPENROUTER_API_KEY is set.
                                    On Claude failure, falls back to OpenRouter
                                    (if available).

Auth notes:
  - For Claude Pro: set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`).
    Do NOT also set ANTHROPIC_API_KEY — it shadows the OAuth token.
  - For OpenRouter: set OPENROUTER_API_KEY.

Public surface (unchanged from before):
    - TOOL_SCHEMAS, dispatch_tool   (used by OpenRouter backend + introspection)
    - stream_chat(messages, on_event, *, model=None, max_hops=...)
    - reset_session()               (clears Claude SDK session state)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable

import aiohttp

from .tools import bash_exec, deep_research, file_ops, hypr, memory, web_search, whatsapp
from . import tts as tts_module


log = logging.getLogger("jarvis.llm")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_OR_MODEL = os.environ.get("JARVIS_MODEL", "openai/gpt-oss-120b:free")
DEFAULT_CLAUDE_MODEL = os.environ.get("JARVIS_CLAUDE_MODEL", "claude-sonnet-4-6")

# Ollama — fully offline, OpenAI-compatible endpoint. Default host is local.
OLLAMA_BASE_URL = os.environ.get("JARVIS_OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_CHAT_URL = OLLAMA_BASE_URL + "/v1/chat/completions"
DEFAULT_OLLAMA_MODEL = os.environ.get("JARVIS_OLLAMA_MODEL", "llama3.1")

MAX_TOOL_HOPS = 12

AVAILABLE_CLAUDE_MODELS = [
    "claude-haiku-4-5",
    "claude-sonnet-4-6",
    "claude-opus-4-7",
]

_active_claude_model: str = DEFAULT_CLAUDE_MODEL


def get_active_model() -> str:
    return _active_claude_model


async def set_claude_model(model_id: str) -> bool:
    """Switch the active Claude model; resets the SDK session so next turn picks it up."""
    global _active_claude_model
    if model_id not in AVAILABLE_CLAUDE_MODELS:
        return False
    if model_id == _active_claude_model:
        return True
    await reset_session()
    _active_claude_model = model_id
    log.info("Claude model switched to %s", model_id)
    return True

EventHandler = Callable[[dict[str, Any]], Awaitable[None]]


# ──────────────────────────────────────────────────────────────────────────
# Tool schemas (OpenAI-compatible; used by the OpenRouter path)
# ──────────────────────────────────────────────────────────────────────────

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "bash_exec",
            "description": "Run any shell command on the Arch Linux host. Returns stdout, stderr, exit_code.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "cwd": {"type": "string"},
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "file_read",
            "description": "Read a file. encoding can be 'utf-8' or 'binary'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "encoding": {"type": "string", "enum": ["utf-8", "binary"]},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "file_write",
            "description": "Write or append to a file. Creates parent dirs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                    "append": {"type": "boolean"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "file_delete",
            "description": "Delete a file or directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "recursive": {"type": "boolean"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "hypr_dispatch",
            "description": "Run a hyprctl dispatcher (workspace, exec, killactive, etc).",
            "parameters": {
                "type": "object",
                "properties": {
                    "dispatcher": {"type": "string"},
                    "args": {"type": "string"},
                },
                "required": ["dispatcher"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for query. Returns top max_results.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_results": {"type": "integer"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "Fetch the text content of a URL.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_save",
            "description": "Persist a memory entry by key with optional tags.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "value": {},
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["key", "value"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_recall",
            "description": "Fuzzy-recall stored memories matching a query.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "deep_research",
            "description": "Deep multi-source web research. Searches multiple query angles in parallel and fetches full content from the best sources. Use for thorough questions that need comprehensive, up-to-date information from across the web.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_sources": {"type": "integer"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_list",
            "description": "List all stored memory entries, most recently updated first.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer"}},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_delete",
            "description": "Delete a stored memory entry by its exact key.",
            "parameters": {
                "type": "object",
                "properties": {"key": {"type": "string"}},
                "required": ["key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "tts_speak",
            "description": "Speak text aloud through piper. Backend strips <jarvis:*> tags first.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "lang": {"type": "string", "enum": ["en", "it", "ru"]},
                },
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "whatsapp_send",
            "description": "Send a WhatsApp message to a saved contact via WhatsApp Web automation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "contact": {"type": "string", "description": "Contact alias (e.g. 'mama', 'luca') or WhatsApp display name"},
                    "message": {"type": "string"},
                },
                "required": ["contact", "message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "whatsapp_add_contact",
            "description": "Save a WhatsApp contact alias mapping (alias → WhatsApp display name).",
            "parameters": {
                "type": "object",
                "properties": {
                    "alias": {"type": "string"},
                    "wa_display_name": {"type": "string", "description": "Exact name as shown in WhatsApp"},
                },
                "required": ["alias", "wa_display_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "whatsapp_list_contacts",
            "description": "List all saved WhatsApp contact aliases.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]


# Names of all JARVIS tools (kept in one place so both backends agree).
TOOL_NAMES = [s["function"]["name"] for s in TOOL_SCHEMAS]


# ──────────────────────────────────────────────────────────────────────────
# Tool dispatcher (used by both backends)
# ──────────────────────────────────────────────────────────────────────────


async def dispatch_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Route a tool call to the right implementation."""
    try:
        if name == "bash_exec":
            return await bash_exec.run(args.get("command", ""), cwd=args.get("cwd"))
        if name == "file_read":
            return await file_ops.read(args["path"], encoding=args.get("encoding", "utf-8"))
        if name == "file_write":
            return await file_ops.write(args["path"], args["content"], append=bool(args.get("append")))
        if name == "file_delete":
            return await file_ops.delete(args["path"], recursive=bool(args.get("recursive")))
        if name == "hypr_dispatch":
            return await hypr.dispatch(args["dispatcher"], args.get("args", ""))
        if name == "web_search":
            return await web_search.search(args["query"], max_results=int(args.get("max_results", 5)))
        if name == "web_fetch":
            return await web_search.fetch(args["url"])
        if name == "memory_save":
            return await memory.save(args["key"], args.get("value"), tags=args.get("tags"))
        if name == "memory_recall":
            return await memory.recall(args["query"])
        if name == "memory_list":
            return await memory.list_memories(limit=int(args.get("limit", 20)))
        if name == "memory_delete":
            return await memory.delete(args["key"])
        if name == "deep_research":
            return await deep_research.research(args["query"], max_sources=int(args.get("max_sources", 10)))
        if name == "tts_speak":
            text = args["text"]
            lang = args.get("lang") or ""
            if not lang or lang == "en":
                from .main import _detect_text_language
                lang = _detect_text_language(text)
            return await tts_module.speak(text, lang=lang)
        if name == "whatsapp_send":
            return await whatsapp.send(args["contact"], args["message"])
        if name == "whatsapp_add_contact":
            return await whatsapp.add_contact(args["alias"], args["wa_display_name"])
        if name == "whatsapp_list_contacts":
            return await whatsapp.list_contacts()
        return {"ok": False, "error": f"unknown tool: {name}"}
    except KeyError as missing:
        return {"ok": False, "error": f"missing required arg: {missing}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ──────────────────────────────────────────────────────────────────────────
# Streaming tag-aware parser (shared by both backends)
# ──────────────────────────────────────────────────────────────────────────

_OPEN_TAG_RE = re.compile(r"<jarvis:([a-zA-Z_][\w-]*)\b([^>]*?)(/?)>")
_CLOSE_TAG_RE = re.compile(r"</jarvis:([a-zA-Z_][\w-]*)\s*>")
_ATTR_RE = re.compile(r'(\w+)\s*=\s*"([^"]*)"')


class StreamParser:
    """Incrementally split a token stream into events.

    Emits one of:
      - {"type":"think_start"} / {"type":"think_delta","text":...} / {"type":"think_end"}
      - {"type":"tag","name":...,"attrs":{...},"body":...}     (task_plan, task_complete)
      - {"type":"step","attrs":{...}}                          (self-closing <jarvis:step/>)
      - {"type":"response_delta","text":...}                   plain spoken text
    """

    def __init__(self) -> None:
        self.buf = ""
        self.mode = "response"  # 'response' | 'think' | 'block:<name>'
        self.block_name: str | None = None
        self.block_attrs: dict[str, str] = {}
        self.block_body: list[str] = []

    def _parse_attrs(self, raw: str) -> dict[str, str]:
        return {m.group(1): m.group(2) for m in _ATTR_RE.finditer(raw)}

    def feed(self, chunk: str) -> list[dict[str, Any]]:
        self.buf += chunk
        events: list[dict[str, Any]] = []
        progress = True
        while progress:
            progress = False
            if self.mode == "response":
                m = _OPEN_TAG_RE.search(self.buf)
                if m is None:
                    safe_until = self._safe_emit_point()
                    if safe_until > 0:
                        events.append({"type": "response_delta", "text": self.buf[:safe_until]})
                        self.buf = self.buf[safe_until:]
                        progress = True
                    break
                if m.start() > 0:
                    events.append({"type": "response_delta", "text": self.buf[:m.start()]})
                name = m.group(1)
                attrs = self._parse_attrs(m.group(2))
                self_close = m.group(3) == "/"
                self.buf = self.buf[m.end():]
                progress = True
                if self_close:
                    if name == "step":
                        events.append({"type": "step", "attrs": attrs})
                    else:
                        events.append({"type": "tag", "name": name, "attrs": attrs, "body": ""})
                    continue
                if name == "think":
                    self.mode = "think"
                    events.append({"type": "think_start"})
                else:
                    self.mode = f"block:{name}"
                    self.block_name = name
                    self.block_attrs = attrs
                    self.block_body = []
            elif self.mode == "think":
                m = _CLOSE_TAG_RE.search(self.buf)
                if m is None or m.group(1) != "think":
                    safe_until = self._safe_emit_point()
                    if safe_until > 0:
                        events.append({"type": "think_delta", "text": self.buf[:safe_until]})
                        self.buf = self.buf[safe_until:]
                        progress = True
                    break
                if m.start() > 0:
                    events.append({"type": "think_delta", "text": self.buf[:m.start()]})
                self.buf = self.buf[m.end():]
                events.append({"type": "think_end"})
                self.mode = "response"
                progress = True
            elif self.mode.startswith("block:"):
                m = _CLOSE_TAG_RE.search(self.buf)
                if m is None or m.group(1) != self.block_name:
                    safe_until = self._safe_emit_point()
                    if safe_until > 0:
                        self.block_body.append(self.buf[:safe_until])
                        self.buf = self.buf[safe_until:]
                        progress = True
                    break
                if m.start() > 0:
                    self.block_body.append(self.buf[:m.start()])
                self.buf = self.buf[m.end():]
                events.append({
                    "type": "tag",
                    "name": self.block_name,
                    "attrs": self.block_attrs,
                    "body": "".join(self.block_body).strip(),
                })
                self.block_name = None
                self.block_attrs = {}
                self.block_body = []
                self.mode = "response"
                progress = True
        return events

    def _safe_emit_point(self) -> int:
        idx = self.buf.rfind("<")
        if idx == -1:
            return len(self.buf)
        return idx

    def finalize(self) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        if self.buf:
            if self.mode == "response":
                events.append({"type": "response_delta", "text": self.buf})
            elif self.mode == "think":
                events.append({"type": "think_delta", "text": self.buf})
                events.append({"type": "think_end"})
            elif self.mode.startswith("block:") and self.block_name:
                self.block_body.append(self.buf)
                events.append({
                    "type": "tag",
                    "name": self.block_name,
                    "attrs": self.block_attrs,
                    "body": "".join(self.block_body).strip(),
                })
            self.buf = ""
        return events


# ──────────────────────────────────────────────────────────────────────────
# OpenAI-compatible streaming (OpenRouter + Ollama share this path)
# ──────────────────────────────────────────────────────────────────────────


async def _stream_completion(
    session: aiohttp.ClientSession,
    url: str,
    api_key: str | None,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
) -> AsyncIterator[dict[str, Any]]:
    payload = {
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "stream": True,
        "temperature": 0.7,
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        # OpenRouter wants Bearer auth + attribution headers; Ollama needs neither.
        headers["Authorization"] = f"Bearer {api_key}"
        headers["HTTP-Referer"] = "https://github.com/EliseyRotar/jarvis-ai"
        headers["X-Title"] = "JARVIS"
    async with session.post(url, headers=headers,
                            data=json.dumps(payload).encode("utf-8")) as r:
        if r.status != 200:
            err = await r.text()
            raise RuntimeError(f"HTTP {r.status}: {err[:500]}")
        async for raw in r.content:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                return
            try:
                obj = json.loads(data)
            except json.JSONDecodeError:
                continue
            choices = obj.get("choices") or []
            if not choices:
                continue
            yield choices[0]


async def _stream_chat_openai_compatible(
    messages: list[dict[str, Any]],
    on_event: EventHandler,
    *,
    url: str,
    api_key: str | None,
    model: str,
    engine: str,
    max_hops: int = MAX_TOOL_HOPS,
) -> dict[str, Any]:
    """Shared tool-calling loop for any OpenAI-compatible chat endpoint."""
    convo = list(messages)
    final_text_chunks: list[str] = []

    timeout = aiohttp.ClientTimeout(total=600, sock_read=120)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        for hop in range(max_hops):
            await on_event({"type": "hop", "n": hop + 1})
            parser = StreamParser()
            collected_text = ""
            tool_calls_acc: dict[int, dict[str, Any]] = {}
            finish_reason: str | None = None

            try:
                async for choice in _stream_completion(session, url, api_key, model, convo, TOOL_SCHEMAS):
                    delta = choice.get("delta") or {}
                    if "content" in delta and delta["content"]:
                        chunk = delta["content"]
                        collected_text += chunk
                        for ev in parser.feed(chunk):
                            await on_event(ev)
                    if "tool_calls" in delta and delta["tool_calls"]:
                        for tc in delta["tool_calls"]:
                            idx = tc.get("index", 0)
                            slot = tool_calls_acc.setdefault(idx, {
                                "id": "", "type": "function",
                                "function": {"name": "", "arguments": ""},
                            })
                            if tc.get("id"):
                                slot["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                slot["function"]["name"] += fn["name"]
                            if fn.get("arguments"):
                                slot["function"]["arguments"] += fn["arguments"]
                    if choice.get("finish_reason"):
                        finish_reason = choice["finish_reason"]
            except Exception as exc:
                await on_event({"type": "error", "message": f"stream failed: {exc}"})
                return {"final_text": "".join(final_text_chunks), "messages": convo}

            for ev in parser.finalize():
                await on_event(ev)

            fresh = StreamParser()
            for ev in fresh.feed(collected_text) + fresh.finalize():
                if ev["type"] == "response_delta":
                    final_text_chunks.append(ev["text"])

            assistant_msg: dict[str, Any] = {"role": "assistant", "content": collected_text}
            if tool_calls_acc:
                assistant_msg["tool_calls"] = [
                    tool_calls_acc[k] for k in sorted(tool_calls_acc)
                ]
            convo.append(assistant_msg)

            if not tool_calls_acc:
                break

            for idx in sorted(tool_calls_acc):
                tc = tool_calls_acc[idx]
                name = tc["function"]["name"]
                raw_args = tc["function"]["arguments"] or "{}"
                try:
                    args = json.loads(raw_args) if raw_args.strip() else {}
                except json.JSONDecodeError:
                    args = {"_raw": raw_args}
                call_id = tc.get("id") or f"call_{uuid.uuid4().hex[:8]}"
                await on_event({"type": "tool_call", "id": call_id, "name": name, "args": args})
                started = time.time()
                try:
                    result = await dispatch_tool(name, args)
                except Exception as exc:
                    result = {"ok": False, "error": str(exc)}
                elapsed = time.time() - started
                await on_event({
                    "type": "tool_result",
                    "id": call_id,
                    "name": name,
                    "result": result,
                    "elapsed_ms": int(elapsed * 1000),
                })
                convo.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": json.dumps(result, ensure_ascii=False)[:32_000],
                })

            if finish_reason == "stop":
                break
        else:
            await on_event({"type": "error", "message": f"max tool hops ({max_hops}) reached"})

    final_text = "".join(final_text_chunks).strip()
    return {"final_text": final_text, "messages": convo}


async def _stream_chat_openrouter(
    messages: list[dict[str, Any]],
    on_event: EventHandler,
    *,
    model: str | None = None,
    max_hops: int = MAX_TOOL_HOPS,
) -> dict[str, Any]:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        await on_event({"type": "error", "message": "OPENROUTER_API_KEY not set"})
        return {"final_text": "", "messages": messages}
    return await _stream_chat_openai_compatible(
        messages, on_event,
        url=OPENROUTER_URL, api_key=api_key,
        model=model or DEFAULT_OR_MODEL, engine="openrouter", max_hops=max_hops,
    )


async def _stream_chat_ollama(
    messages: list[dict[str, Any]],
    on_event: EventHandler,
    *,
    model: str | None = None,
    max_hops: int = MAX_TOOL_HOPS,
) -> dict[str, Any]:
    return await _stream_chat_openai_compatible(
        messages, on_event,
        url=OLLAMA_CHAT_URL, api_key=None,
        model=model or DEFAULT_OLLAMA_MODEL, engine="ollama", max_hops=max_hops,
    )


# ──────────────────────────────────────────────────────────────────────────
# Claude Agent SDK backend
# ──────────────────────────────────────────────────────────────────────────

_claude_client: Any = None
_claude_lock = asyncio.Lock()
_claude_tool_name_by_id: dict[str, str] = {}
_claude_pending_call_started: dict[str, float] = {}


def _make_claude_tools():
    """Return a list of @tool-decorated wrappers around dispatch_tool."""
    from claude_agent_sdk import tool

    def _wrap(name: str, description: str, schema: dict[str, Any]):
        @tool(name, description, schema)
        async def _runner(args: dict[str, Any]) -> dict[str, Any]:
            result = await dispatch_tool(name, args)
            try:
                text = json.dumps(result, ensure_ascii=False)
            except Exception:
                text = str(result)
            if len(text) > 30_000:
                text = text[:30_000] + "\n... [truncated]"
            return {"content": [{"type": "text", "text": text}]}
        return _runner

    return [
        _wrap("bash_exec", "Run any shell command on the Arch Linux host.",
              {"command": str, "cwd": str}),
        _wrap("file_read", "Read a file. encoding: utf-8 or binary.",
              {"path": str, "encoding": str}),
        _wrap("file_write", "Write or append to a file (creates parent dirs).",
              {"path": str, "content": str, "append": bool}),
        _wrap("file_delete", "Delete a file or directory.",
              {"path": str, "recursive": bool}),
        _wrap("hypr_dispatch", "Run a hyprctl dispatcher.",
              {"dispatcher": str, "args": str}),
        _wrap("web_search", "Web search; returns top results.",
              {"query": str, "max_results": int}),
        _wrap("web_fetch", "Fetch text content of a URL.",
              {"url": str}),
        _wrap("memory_save", "Persist a memory entry by key with optional tags.",
              {"key": str, "value": str, "tags": list}),
        _wrap("memory_recall", "Fuzzy-recall stored memories matching a query.",
              {"query": str}),
        _wrap("memory_list", "List all stored memories, most recent first.",
              {"limit": int}),
        _wrap("memory_delete", "Delete a stored memory by exact key.",
              {"key": str}),
        _wrap("deep_research", "Deep multi-source web research across multiple query angles.",
              {"query": str, "max_sources": int}),
        _wrap("tts_speak", "Speak text aloud through piper (tags stripped).",
              {"text": str, "lang": str}),
        _wrap("whatsapp_send", "Send a WhatsApp message via WhatsApp Web automation.",
              {"contact": str, "message": str}),
        _wrap("whatsapp_add_contact", "Save a WhatsApp contact alias → display name mapping.",
              {"alias": str, "wa_display_name": str}),
        _wrap("whatsapp_list_contacts", "List all saved WhatsApp contact aliases.", {}),
    ]


MCP_CONFIG_PATH = Path.home() / ".jarvis" / "mcp.json"


def _load_external_mcp_servers() -> dict[str, Any]:
    """Load external MCP server definitions from ~/.jarvis/mcp.json.

    Format matches Claude Code's .mcp.json:
        {"mcpServers": {"github": {"command": "npx", "args": [...], "env": {...}},
                        "weather": {"type": "sse", "url": "http://..."}}}
    Returns {} if the file is missing or malformed.
    """
    if not MCP_CONFIG_PATH.exists():
        return {}
    try:
        data = json.loads(MCP_CONFIG_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("could not read %s: %s", MCP_CONFIG_PATH, exc)
        return {}
    servers = data.get("mcpServers") or data.get("mcp_servers") or {}
    if not isinstance(servers, dict):
        log.warning("mcp.json: 'mcpServers' must be an object — ignoring")
        return {}
    return servers


async def _get_claude_client(system_prompt: str) -> Any:
    """Lazy-init and cache one ClaudeSDKClient for the lifetime of the process."""
    global _claude_client
    if _claude_client is not None:
        return _claude_client
    async with _claude_lock:
        if _claude_client is not None:
            return _claude_client

        from claude_agent_sdk import (
            ClaudeSDKClient, ClaudeAgentOptions, create_sdk_mcp_server,
        )

        server = create_sdk_mcp_server(
            name="jarvis_tools",
            version="1.0.0",
            tools=_make_claude_tools(),
        )

        mcp_servers: dict[str, Any] = {"jarvis_tools": server}
        allowed = [f"mcp__jarvis_tools__{n}" for n in TOOL_NAMES]

        # Merge any user-defined external MCP servers (~/.jarvis/mcp.json).
        for name, cfg in _load_external_mcp_servers().items():
            mcp_servers[name] = cfg
            allowed.append(f"mcp__{name}")  # permit all tools from this server
        if len(mcp_servers) > 1:
            log.info("loaded %d external MCP server(s): %s",
                     len(mcp_servers) - 1,
                     ", ".join(n for n in mcp_servers if n != "jarvis_tools"))

        options = ClaudeAgentOptions(
            system_prompt=system_prompt,
            mcp_servers=mcp_servers,
            allowed_tools=allowed,
            model=_active_claude_model,
            permission_mode="bypassPermissions",
        )

        client = ClaudeSDKClient(options=options)
        await client.connect()
        _claude_client = client
        log.info("claude SDK client connected (model=%s)", _active_claude_model)
        return _claude_client


async def _stream_chat_claude(
    messages: list[dict[str, Any]],
    on_event: EventHandler,
) -> dict[str, Any]:
    """Run one turn through the Claude Agent SDK, streaming events out."""
    # System prompt = first system message; user input = latest user message
    system_prompt = ""
    user_text = ""
    for m in messages:
        if m.get("role") == "system" and not system_prompt:
            system_prompt = m.get("content", "")
    for m in reversed(messages):
        if m.get("role") == "user":
            user_text = m.get("content", "")
            break

    if not user_text.strip():
        return {"final_text": "", "messages": messages}

    # Connect, with one automatic reconnect if the cached client is stale.
    client = None
    for attempt in range(2):
        try:
            client = await _get_claude_client(system_prompt)
            break
        except ImportError:
            await on_event({"type": "error", "message": "claude-agent-sdk not installed"})
            raise
        except Exception as exc:
            if attempt == 0:
                log.warning("Claude client connect failed (%s), resetting and retrying", exc)
                await reset_session()
            else:
                await on_event({"type": "error", "message": f"Claude SDK connect failed: {exc}"})
                raise
    assert client is not None

    from claude_agent_sdk import (
        AssistantMessage, UserMessage, ResultMessage,
        TextBlock, ToolUseBlock, ToolResultBlock,
    )
    try:
        from claude_agent_sdk import ThinkingBlock  # type: ignore
    except ImportError:
        ThinkingBlock = None  # type: ignore

    parser = StreamParser()
    final_text_chunks: list[str] = []
    seen_text_per_block: dict[int, int] = {}  # block id → how many chars already emitted

    await on_event({"type": "hop", "n": 1})

    # Send query; on error reset + retry once with a fresh client.
    for attempt in range(2):
        try:
            await client.query(user_text)
            break
        except Exception as exc:
            if attempt == 0:
                log.warning("Claude query failed (%s), reconnecting", exc)
                await reset_session()
                try:
                    client = await _get_claude_client(system_prompt)
                except Exception as reconnect_exc:
                    await on_event({"type": "error", "message": f"Claude reconnect failed: {reconnect_exc}"})
                    raise
            else:
                await on_event({"type": "error", "message": f"Claude query failed: {exc}"})
                raise

    block_seq = 0
    try:
        async for msg in client.receive_response():
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    block_seq += 1
                    if isinstance(block, TextBlock):
                        # Stream only the delta (new text) for this block.
                        prev = seen_text_per_block.get(id(block), 0)
                        chunk = (block.text or "")[prev:]
                        seen_text_per_block[id(block)] = len(block.text or "")
                        if chunk:
                            for ev in parser.feed(chunk):
                                await on_event(ev)
                                if ev["type"] == "response_delta":
                                    final_text_chunks.append(ev["text"])
                    elif isinstance(block, ToolUseBlock):
                        raw_name = getattr(block, "name", "") or ""
                        display = raw_name.split("__")[-1] if "__" in raw_name else raw_name
                        call_id = getattr(block, "id", "") or f"call_{uuid.uuid4().hex[:8]}"
                        _claude_tool_name_by_id[call_id] = display
                        _claude_pending_call_started[call_id] = time.time()
                        await on_event({
                            "type": "tool_call",
                            "id": call_id,
                            "name": display,
                            "args": getattr(block, "input", {}) or {},
                        })
                    elif ThinkingBlock is not None and isinstance(block, ThinkingBlock):
                        text = getattr(block, "thinking", "") or ""
                        if text:
                            await on_event({"type": "think_start"})
                            await on_event({"type": "think_delta", "text": text})
                            await on_event({"type": "think_end"})
            elif isinstance(msg, UserMessage):
                content = msg.content if isinstance(msg.content, list) else []
                for block in content:
                    if isinstance(block, ToolResultBlock):
                        # Reconstruct result dict
                        tool_use_id = getattr(block, "tool_use_id", "") or ""
                        raw = block.content
                        text = ""
                        if isinstance(raw, str):
                            text = raw
                        elif isinstance(raw, list):
                            for cb in raw:
                                if hasattr(cb, "text"):
                                    text += getattr(cb, "text", "") or ""
                                elif isinstance(cb, dict) and "text" in cb:
                                    text += cb["text"] or ""
                        try:
                            result_obj = json.loads(text)
                        except (json.JSONDecodeError, TypeError):
                            result_obj = {"text": text}
                        name = _claude_tool_name_by_id.pop(tool_use_id, "")
                        started = _claude_pending_call_started.pop(tool_use_id, time.time())
                        await on_event({
                            "type": "tool_result",
                            "id": tool_use_id,
                            "name": name,
                            "result": result_obj,
                            "elapsed_ms": int((time.time() - started) * 1000),
                        })
            elif isinstance(msg, ResultMessage):
                # Turn complete.
                break
    except Exception as exc:
        await on_event({"type": "error", "message": f"Claude stream failed: {exc}"})
        raise

    for ev in parser.finalize():
        await on_event(ev)
        if ev["type"] == "response_delta":
            final_text_chunks.append(ev["text"])

    final_text = "".join(final_text_chunks).strip()
    new_messages = list(messages) + [{"role": "assistant", "content": final_text}]
    return {"final_text": final_text, "messages": new_messages}


async def reset_session() -> None:
    """Clear any persistent Claude SDK session state (called by /reset)."""
    global _claude_client
    async with _claude_lock:
        if _claude_client is not None:
            try:
                await _claude_client.disconnect()
            except Exception:
                pass
            _claude_client = None
        _claude_tool_name_by_id.clear()
        _claude_pending_call_started.clear()


# ──────────────────────────────────────────────────────────────────────────
# Public dispatcher
# ──────────────────────────────────────────────────────────────────────────


def _pick_backend() -> str:
    explicit = (os.environ.get("JARVIS_LLM_BACKEND") or "auto").lower()
    has_claude = bool(os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"))
    has_or = bool(os.environ.get("OPENROUTER_API_KEY"))
    has_ollama = bool(os.environ.get("JARVIS_OLLAMA_MODEL") or os.environ.get("JARVIS_OLLAMA_URL"))
    has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))

    if explicit == "claude":
        return "claude"
    if explicit == "openrouter":
        return "openrouter"
    if explicit == "ollama":
        return "ollama"
    # auto
    if has_claude and not has_anthropic:
        return "claude"
    if has_or:
        return "openrouter"
    if has_ollama:
        return "ollama"
    if has_claude and has_anthropic:
        # ANTHROPIC_API_KEY would shadow the OAuth token; warn but still try Claude
        log.warning("Both CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY are set. "
                    "API key will shadow OAuth — usage will hit your API budget, not your Pro plan.")
        return "claude"
    return "none"


async def stream_chat(
    messages: list[dict[str, Any]],
    on_event: EventHandler,
    *,
    model: str | None = None,
    max_hops: int = MAX_TOOL_HOPS,
) -> dict[str, Any]:
    """Pick a backend and run one chat turn.

    Returns {"final_text": str, "messages": [...]}; final_text is the
    spoken response (tag-stripped) ready for TTS.
    """
    backend = _pick_backend()
    has_or = bool(os.environ.get("OPENROUTER_API_KEY"))

    if backend == "claude":
        try:
            return await _stream_chat_claude(messages, on_event)
        except Exception as exc:
            log.exception("Claude backend failed")
            if has_or:
                await on_event({
                    "type": "error",
                    "message": f"Claude backend failed ({exc}); falling back to OpenRouter",
                })
                # Reset to allow re-init next time
                await reset_session()
                return await _stream_chat_openrouter(messages, on_event, model=model, max_hops=max_hops)
            return {"final_text": "", "messages": messages}

    if backend == "openrouter":
        return await _stream_chat_openrouter(messages, on_event, model=model, max_hops=max_hops)

    if backend == "ollama":
        return await _stream_chat_ollama(messages, on_event, model=model, max_hops=max_hops)

    await on_event({
        "type": "error",
        "message": "No LLM backend available. Set CLAUDE_CODE_OAUTH_TOKEN (Claude Pro), "
                   "OPENROUTER_API_KEY, or JARVIS_OLLAMA_MODEL (offline).",
    })
    return {"final_text": "", "messages": messages}
