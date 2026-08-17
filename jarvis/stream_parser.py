"""Streaming tag-aware parser used by both the legacy Claude/OpenRouter backend
and (historically) the Hermes bridge. Stateless, dependency-free.

The parser splits an incremental token stream into typed events the orb UI can
render directly:
  - {"type": "think_start"} / {"type": "think_delta", "text": ...} / {"type": "think_end"}
  - {"type": "tag", "name": ..., "attrs": {...}, "body": ...}   (task_plan, task_complete, …)
  - {"type": "step", "attrs": {...}}                            (self-closing <jarvis:step/>)
  - {"type": "response_delta", "text": ...}                     plain spoken text

The grammar is:
    response     ::= ( think | block | text )*
    think        ::= '<jarvis:think>' text '</jarvis:think>'
    block        ::= '<jarvis:NAME attrs?>' body '</jarvis:NAME>'
    step         ::= '<jarvis:step attrs?/>'
    text         ::= any characters not starting a tag
"""
from __future__ import annotations

import re
from typing import Any

_OPEN_TAG_RE = re.compile(r"<jarvis:([a-zA-Z_][\w-]*)\b([^>]*?)(/?)>")
_CLOSE_TAG_RE = re.compile(r"</jarvis:([a-zA-Z_][\w-]*)\s*>")
_ATTR_RE = re.compile(r'(\w+)\s*=\s*"([^"]*)"')


class StreamParser:
    """Incrementally split a token stream into typed events."""

    def __init__(self) -> None:
        self.buf = ""
        self.mode = "response"
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
