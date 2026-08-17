"""Voice command intent classification.

Lightweight, deterministic — no LLM involved. Intercepts a transcribed wake-word
utterance *before* it reaches the normal chat turn, so simple commands like
"create a new project called finance" can be answered immediately by JARVIS
without burning a full LLM round-trip.

Add new commands by extending ``INTENT_PATTERNS`` and providing a handler in
``handle_voice_intent``.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Awaitable, Callable

log = logging.getLogger("jarvis.voice_intents")

SendFn = Callable[[dict[str, Any]], Awaitable[None]]


# Each pattern is (regex, intent_name). First match wins. Patterns are
# intentionally specific so we never false-positive on normal chat.
INTENT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(
        r"\b(create|add|new|register)\b.{0,12}\b(project|profile)\b"
        r"(?:\s+(?:called|named|for))?\s+(?P<name>[a-z0-9][a-z0-9_-]{0,31})\b",
        re.IGNORECASE),
     "create_project"),
    (re.compile(
        r"\b(list|show)\b(?:\s+(?:me|all))?\s+(?:all\s+)?\b(projects|profiles|modes)\b",
        re.IGNORECASE),
     "list_projects"),
    (re.compile(
        r"\bswitch\s+to\s+(?:project\s+|profile\s+|mode\s+)?(?P<name>[a-z0-9][a-z0-9_-]{0,31})\b",
        re.IGNORECASE),
     "switch_mode"),
]


def classify(text: str) -> tuple[str, dict[str, str]] | None:
    """Return (intent_name, groups) if the utterance matches a voice command, else None."""
    if not text:
        return None
    for pattern, intent in INTENT_PATTERNS:
        m = pattern.search(text)
        if m:
            return intent, m.groupdict()
    return None


async def handle_voice_intent(
    intent: str,
    groups: dict[str, str],
    *,
    send: SendFn,
    broadcast: SendFn | None = None,
) -> bool:
    """Dispatch a voice-intent. Returns True if it handled the utterance
    (so the caller should NOT pass it to the normal chat loop)."""

    if intent == "list_projects":
        from .admin.add_project import list_projects
        projects = list_projects()
        names = [p["name"] for p in projects]
        if send:
            text = "Registered projects: " + ", ".join(names)
            await send({"type": "toast", "kind": "info", "message": text})
        log.info("voice-intent list_projects: %s", names)
        return True

    if intent == "switch_mode":
        from .admin.add_project import list_projects
        name = (groups.get("name") or "").lower()
        valid = {p["name"] for p in list_projects()}
        if name not in valid:
            if send:
                await send({"type": "toast", "kind": "err",
                            "message": f"Unknown mode: {name}"})
            return True
        # Switch via HTTP-style call: we can't easily reach the FastAPI handler
        # from inside this module without circular deps, so we just call the
        # underlying state-mutator exposed in main.py.
        from . import main as _main
        _main._current_mode = name
        _main._reset_conversation()
        await _main.hub.broadcast({"type": "mode_changed", "mode": name})
        if send:
            await send({"type": "toast", "kind": "ok", "message": f"Mode: {name}"})
        log.info("voice-intent switch_mode: %s", name)
        return True

    if intent == "create_project":
        name = (groups.get("name") or "").lower()
        # We need a cwd. The user didn't supply one via voice, so we prompt
        # the orb UI to open the wizard with this name pre-filled. Falls back
        # to a toast telling them to finish via the UI.
        from . import main as _main
        await _main.hub.broadcast({
            "type": "wizard_request",
            "intent": "create_project",
            "name": name,
        })
        if send:
            await send({"type": "toast", "kind": "info",
                        "message": (f"Opening project wizard for '{name}'. "
                                    "Pick the working directory and continue.")})
        log.info("voice-intent create_project: name=%s", name)
        return True

    return False
