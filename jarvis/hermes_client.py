"""Hermes Agent API client — bridges JARVIS's voice server to Hermes.

Hermes runs its own gateway with an OpenAI-compatible API server on
127.0.0.1:8642. This module talks to the Sessions API:

    POST /api/sessions                    → create a stable session row
    POST /api/sessions/{id}/chat/stream   → SSE stream of one agent turn
    POST /v1/runs/{run_id}/stop           → interrupt a running agent

The sessions stream carries FULL tool args (unlike /v1/runs), which lets
JARVIS translate Hermes `todo` tool calls into the Agentic Task Engine
events the orb UI renders as a live progress tracker.

Routing (with ``gateway.multiplex_profiles: true`` the gateway serves every
profile under a ``/p/<profile>/`` prefix):

    mode="default" → default profile (Cosmo persona)
    mode="wwf"     → wwf profile (work mode, Cosmo voice + WWF context)
    mode="<name>"  → user-added profile from the project wizard

Voice is unified: Cosmo. Project context comes from each profile's SOUL.md.
Each profile has its own API key, memory, and session id.

Public surface:
    - stream_chat(messages, on_event, *, mode="default")
    - stop_run()
    - reset_session()
    - _pick_backend() / get_active_model() / get_models() / set_model()
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

import aiohttp

log = logging.getLogger("jarvis.hermes")

HERMES_URL = os.environ.get("JARVIS_HERMES_URL", "http://127.0.0.1:8642").rstrip("/")

# Ollama Cloud catalog (fetched from https://ollama.com/v1/models at setup time).
AVAILABLE_MODELS = [
    "gpt-oss:120b",
    "qwen3.5:397b",
    "kimi-k3",
    "glm-5.2",
    "glm-5.1",
    "kimi-k2.7-code",
    "kimi-k2.6",
    "minimax-m3",
    "minimax-m2.7",
    "nemotron-3-ultra",
    "nemotron-3-super",
    "nemotron-3-nano:30b",
    "mistral-large-3:675b",
    "gemma4:31b",
    "deepseek-v4-pro:preview",
    "deepseek-v4-flash:preview",
    "deepseek-v4-flash:0731",
    "gpt-oss:20b",
]
DEFAULT_MODEL = os.environ.get("JARVIS_MODEL", "gpt-oss:20b")

# Back-compat aliases for main.py's old llm.py references.
DEFAULT_OR_MODEL = DEFAULT_MODEL
DEFAULT_OLLAMA_MODEL = DEFAULT_MODEL
DEFAULT_CLAUDE_MODEL = DEFAULT_MODEL

_active_model: str = DEFAULT_MODEL

EventHandler = Callable[[dict[str, Any]], Awaitable[None]]


def _read_env_file(path: Path) -> dict[str, str]:
    """Parse a simple KEY=VALUE .env file into a dict."""
    out: dict[str, str] = {}
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[len("export "):].lstrip()
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            if (val.startswith('"') and val.endswith('"')) or \
               (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            if key:
                out[key] = val
    except OSError:
        pass
    return out


def _hermes_home() -> Path:
    env = os.environ.get("HERMES_HOME")
    if env:
        return Path(env)
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "hermes"
    return Path.home() / ".hermes"


def _load_keys() -> dict[str, str]:
    """Resolve API keys for every Hermes profile under ~/.hermes/profiles/*/

    Built-in profiles (default, wwf, eli6) are loaded explicitly. Any
    additional profile directory the user has created via the project wizard
    is auto-discovered here too.
    """
    keys: dict[str, str] = {}
    home = _hermes_home()
    default_env = _read_env_file(home / ".env")
    keys["default"] = os.environ.get("JARVIS_HERMES_API_KEY") or default_env.get("API_SERVER_KEY", "")

    profiles_dir = home / "profiles"
    if profiles_dir.is_dir():
        for entry in sorted(profiles_dir.iterdir()):
            if not entry.is_dir():
                continue
            env = _read_env_file(entry / ".env")
            key = env.get("API_SERVER_KEY", "")
            if key:
                keys[entry.name] = (
                    os.environ.get(f"JARVIS_HERMES_{entry.name.upper()}_KEY") or key
                )

    # Back-compat explicit aliases for the built-in profiles so env-var
    # overrides keep working.
    wwf_env = _read_env_file(home / "profiles" / "wwf" / ".env")
    if "wwf" in keys:
        keys["wwf"] = os.environ.get("JARVIS_HERMES_WWF_KEY") or keys["wwf"]
    elif wwf_env.get("API_SERVER_KEY"):
        keys["wwf"] = os.environ.get("JARVIS_HERMES_WWF_KEY") or wwf_env["API_SERVER_KEY"]
    eli6_env = _read_env_file(home / "profiles" / "eli6" / ".env")
    if "eli6" in keys:
        keys["eli6"] = os.environ.get("JARVIS_HERMES_ELI6_KEY") or keys["eli6"]
    elif eli6_env.get("API_SERVER_KEY"):
        keys["eli6"] = os.environ.get("JARVIS_HERMES_ELI6_KEY") or eli6_env["API_SERVER_KEY"]

    return keys


_KEYS = _load_keys()

# Stable session ids per profile so Hermes memory/session tracking persists
# across voice-server restarts. reset_session() clears them. Any additional
# profile directory on disk gets a stable jarvis-orb-<name> session id here.
_SESSION_IDS: dict[str, str | None] = {"default": "jarvis-orb"}
home = _hermes_home()
profiles_dir = home / "profiles"
if profiles_dir.is_dir():
    for entry in sorted(profiles_dir.iterdir()):
        if entry.is_dir() and entry.name not in _SESSION_IDS:
            _SESSION_IDS[entry.name] = f"jarvis-orb-{entry.name}"
_SESSION_IDS.setdefault("wwf", "jarvis-orb-wwf")
_SESSION_IDS.setdefault("eli6", "jarvis-orb-eli6")

_active_run_id: str | None = None
_active_run_lock = asyncio.Lock()


def _resolve_profile(mode: str) -> str:
    """Map a mode name to a Hermes profile.

    - mode matches a known profile name -> that profile (e.g. "default", "wwf", "finance")
    - otherwise                          -> default profile

    Voice is unified (Cosmo) across all profiles; persona overrides have
    been removed. Project SOUL.md files provide per-project context.
    """
    if mode and mode in _SESSION_IDS:
        return mode
    return "default"


def _profile_url(profile: str) -> str:
    if profile == "default":
        return HERMES_URL
    return f"{HERMES_URL}/p/{profile}"


def _profile_key(profile: str) -> str:
    return _KEYS.get(profile, "")


def _pick_backend() -> str:
    return "hermes"


def get_active_model() -> str:
    return _active_model


def get_models() -> list[str]:
    return list(AVAILABLE_MODELS)


async def set_model(model_id: str) -> bool:
    """Switch the active model (sent per-request to Hermes).

    The sessions API pins the model at session creation, so switching models
    resets the stable session ids — the next turn creates fresh sessions with
    the new model.
    """
    global _active_model
    if model_id not in AVAILABLE_MODELS:
        return False
    if model_id != _active_model:
        _active_model = model_id
        reset_session()
        log.info("Hermes model switched to %s (sessions reset)", model_id)
    return True


def reset_session() -> None:
    """Forget stable session ids so the next run starts a fresh Hermes session."""
    for key in _SESSION_IDS:
        _SESSION_IDS[key] = None


async def stop_run() -> bool:
    """Interrupt the currently active Hermes run (barge-in / STOP button)."""
    global _active_run_id
    async with _active_run_lock:
        run_id = _active_run_id
    if not run_id:
        return False
    url = f"{HERMES_URL}/v1/runs/{run_id}/stop"
    headers = {"Authorization": f"Bearer {_KEYS['default']}"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                return resp.status < 400
    except Exception as exc:
        log.warning("stop_run failed: %s", exc)
        return False


async def _parse_sse(resp: aiohttp.ClientResponse) -> Any:
    """Yield (event_name, payload) tuples from an SSE response."""
    event_name = ""
    data_lines: list[str] = []
    async for raw in resp.content:
        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        if line == "":
            if data_lines:
                try:
                    payload = json.loads("\n".join(data_lines))
                except json.JSONDecodeError:
                    payload = None
                if payload is not None:
                    yield event_name, payload
            event_name = ""
            data_lines = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[len("event:"):].strip()
        elif line.startswith("data:"):
            data_lines.append(line[len("data:"):].strip())


async def _ensure_session(session: aiohttp.ClientSession, base: str, key: str, session_id: str) -> None:
    """Create the session row if it doesn't exist (409 = already exists, fine).

    The model is pinned at session creation — the chat/stream endpoint uses
    the session's stored model, not the per-request one.
    """
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        async with session.post(
            f"{base}/api/sessions",
            json={"id": session_id, "source": "jarvis-orb", "model": _active_model},
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            if resp.status in (201, 409):
                return
            log.warning("session create returned %s", resp.status)
    except Exception as exc:
        log.warning("session create failed (continuing anyway): %s", exc)


# ──────────────────────────────────────────────────────────────────────────
# Agentic Task Engine — translates Hermes `todo` tool calls into the
# task_update events the orb UI renders as a live progress tracker.
# ──────────────────────────────────────────────────────────────────────────

_STATUS_MAP = {
    "pending": "pending",
    "in_progress": "running",
    "completed": "done",
    "cancelled": "error",
}


class TodoTracker:
    """Consumes tool.started events for the Hermes `todo` tool and emits
    task_plan / step / task_complete snapshots in the old ATE shape."""

    def __init__(self) -> None:
        self._items: list[dict[str, Any]] = []
        self._started_at: float | None = None
        self._last_snapshot: dict[str, Any] | None = None

    def handle_todo_args(self, args: Any) -> dict[str, Any] | None:
        """Feed a todo tool call's args; return a task_update snapshot or None."""
        if not isinstance(args, dict):
            return None
        todos = args.get("todos")
        if isinstance(todos, str):
            try:
                todos = json.loads(todos)
            except json.JSONDecodeError:
                return None
        if not isinstance(todos, list) or not todos:
            return None
        merge = bool(args.get("merge"))
        if not merge or not self._items:
            self._items = []
            self._started_at = time.time()
        by_id = {t.get("id"): t for t in self._items}
        for t in todos:
            if not isinstance(t, dict) or "id" not in t:
                continue
            # Merge updates often carry only {id, status} — preserve the
            # original content so step labels don't get wiped.
            if merge and t.get("id") in by_id and "content" not in t:
                t = {**by_id[t["id"]], **t}
            by_id[t["id"]] = t
        self._items = list(by_id.values())

        steps = [
            {
                "n": i + 1,
                "label": str(t.get("content", "")),
                "status": _STATUS_MAP.get(t.get("status", "pending"), "pending"),
            }
            for i, t in enumerate(self._items)
        ]
        done = sum(1 for s in steps if s["status"] == "done")
        total = len(steps)
        all_done = total > 0 and done == total
        plan = {
            "task_id": "task_hermes",
            "total_steps": total,
            "goal": "",
            "steps": steps,
            "started_at": self._started_at or time.time(),
            "status": "success" if all_done else "running",
            "progress": round((done / total) * 100.0, 1) if total else 0.0,
        }
        if all_done:
            plan["summary"] = "All steps completed."
            plan["finished_at"] = time.time()
        snapshot = {
            "kind": "task_complete" if all_done else "task_plan",
            "plan": plan,
        }
        # Only emit when something changed (Hermes re-sends the full list).
        if snapshot == self._last_snapshot:
            return None
        self._last_snapshot = snapshot
        return snapshot


async def stream_chat(
    messages: list[dict[str, Any]],
    on_event: EventHandler,
    *,
    mode: str = "default",
) -> dict[str, Any]:
    """Run one agent turn through Hermes, streaming events to ``on_event``.

    ``messages`` is the local conversation (system message first, if any).
    The last user message becomes the run input; everything before it is
    sent as conversation_history so Hermes has full context.

    Returns the same shape as the old llm.stream_chat:
        {"messages": [...], "final_text": "..."}
    """
    global _active_run_id

    profile = _resolve_profile(mode)
    key = _profile_key(profile)
    if not key:
        await on_event({"type": "error", "message": f"Hermes API key missing for profile '{profile}'"})
        return {"messages": messages, "final_text": ""}

    # Split: last user message = input, everything before = history.
    history: list[dict[str, str]] = []
    user_message = ""
    for m in messages:
        role = m.get("role")
        content = m.get("content")
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=False)
        if role == "user":
            if user_message:
                history.append({"role": "user", "content": user_message})
            user_message = content
        elif role == "assistant":
            if user_message:
                history.append({"role": "user", "content": user_message})
                user_message = ""
            history.append({"role": "assistant", "content": content})
        # system messages are dropped — Hermes has its own SOUL.md

    if not user_message:
        await on_event({"type": "error", "message": "No user message to send"})
        return {"messages": messages, "final_text": ""}

    base = _profile_url(profile)
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    timeout = aiohttp.ClientTimeout(total=1800, connect=15)
    started = time.time()
    final_text = ""
    tool_ids: dict[str, int] = {}
    tool_elapsed: dict[str, float] = {}
    todo_tracker = TodoTracker()

    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            session_id = _SESSION_IDS.get(profile) or f"jarvis-orb-{profile}"
            _SESSION_IDS[profile] = session_id
            await _ensure_session(session, base, key, session_id)

            body: dict[str, Any] = {
                "message": user_message,
                "model": _active_model,
            }
            if history:
                body["conversation_history"] = history[-40:]

            async with session.post(
                f"{base}/api/sessions/{session_id}/chat/stream",
                json=body,
                headers=headers,
            ) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    await on_event({"type": "error", "message": f"Hermes turn failed ({resp.status}): {text[:300]}"})
                    return {"messages": messages, "final_text": ""}

                async for event_name, payload in _parse_sse(resp):
                    if event_name == "run.started":
                        run_id = payload.get("run_id")
                        if run_id:
                            async with _active_run_lock:
                                _active_run_id = run_id
                    elif event_name == "assistant.delta":
                        delta = payload.get("delta", "")
                        if delta:
                            await on_event({"type": "response_delta", "text": delta})
                    elif event_name == "tool.progress":
                        # reasoning streamed as tool.progress with tool_name="_thinking"
                        if payload.get("tool_name") == "_thinking":
                            text = payload.get("delta", "")
                            if text:
                                await on_event({"type": "think_delta", "text": text})
                    elif event_name == "tool.started":
                        name = payload.get("tool_name") or "tool"
                        args = payload.get("args")
                        n = tool_ids.get(name, 0) + 1
                        tool_ids[name] = n
                        tool_elapsed[name] = time.time()
                        await on_event({
                            "type": "tool_call",
                            "id": f"{name}-{n}",
                            "name": name,
                            "args": args or {},
                        })
                        if name == "todo":
                            snap = todo_tracker.handle_todo_args(args)
                            if snap is not None:
                                await on_event({"type": "task_update", **snap})
                    elif event_name == "tool.completed":
                        name = payload.get("tool_name") or "tool"
                        n = tool_ids.get(name, 1)
                        started_at = tool_elapsed.get(name, time.time())
                        is_error = bool(payload.get("error"))
                        await on_event({
                            "type": "tool_result",
                            "id": f"{name}-{n}",
                            "name": name,
                            "result": {"ok": not is_error, "error": is_error},
                            "elapsed_ms": round((time.time() - started_at) * 1000),
                        })
                    elif event_name == "assistant.completed":
                        # The sessions API delivers the final text here
                        # (run.completed carries the tool-call transcript).
                        content = payload.get("content")
                        if isinstance(content, str) and content.strip():
                            final_text = content
                    elif event_name == "run.completed":
                        if not final_text:
                            final_text = _extract_final_text(payload)
                    elif event_name == "error":
                        await on_event({"type": "error", "message": payload.get("message", "Hermes error")})
                    elif event_name == "done":
                        break
    except asyncio.CancelledError:
        # Barge-in: try to stop the Hermes run before propagating.
        await stop_run()
        raise
    except aiohttp.ClientError as exc:
        log.exception("Hermes stream failed")
        await on_event({"type": "error", "message": f"Hermes connection failed: {exc}"})
        return {"messages": messages, "final_text": ""}
    finally:
        async with _active_run_lock:
            _active_run_id = None

    elapsed = round(time.time() - started, 2)
    log.info("hermes turn done in %.2fs (profile=%s)", elapsed, profile)

    # Update the local conversation with the final exchange.
    updated = [m for m in messages if m.get("role") != "system"]
    updated.append({"role": "user", "content": user_message})
    if final_text:
        updated.append({"role": "assistant", "content": final_text})
    return {"messages": updated, "final_text": final_text}


def _extract_final_text(payload: dict[str, Any]) -> str:
    """Pull the final assistant text out of a run.completed payload."""
    output = payload.get("output")
    if isinstance(output, str) and output.strip():
        return output
    for m in payload.get("messages", []):
        if m.get("role") == "assistant":
            content = m.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = [
                    p.get("text", "")
                    for p in content
                    if isinstance(p, dict) and p.get("type") in ("text", "output_text")
                ]
                return "".join(parts)
    return ""
