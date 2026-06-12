"""Messaging channels — reach JARVIS from outside the local HUD.

A minimal, dependency-free channel layer inspired by OpenJarvis's BaseChannel
registry. Currently ships a Telegram channel that long-polls the Bot API with
stdlib urllib (no python-telegram-bot needed) and hands each incoming message to
a callback — JARVIS answers as if you'd typed it in the HUD, then the reply is
sent back to the same chat.

Enable by setting JARVIS_TELEGRAM_TOKEN (from @BotFather) in ~/.jarvis/.env.
Optionally restrict to your own account with JARVIS_TELEGRAM_ALLOWED_IDS
(comma-separated numeric chat ids).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.parse
import urllib.request
from typing import Any, Awaitable, Callable

log = logging.getLogger("jarvis.channels")

_API = "https://api.telegram.org/bot{token}/{method}"


def _call(token: str, method: str, params: dict[str, Any], timeout: float = 35.0) -> dict[str, Any]:
    url = _API.format(token=token, method=method)
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=data)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


class TelegramChannel:
    """Long-polling Telegram bridge. send() and the poll loop are thread-safe."""

    channel_id = "telegram"

    def __init__(self, token: str, allowed_ids: set[int] | None = None) -> None:
        self.token = token
        self.allowed_ids = allowed_ids or set()
        self._offset = 0

    def send(self, chat_id: int | str, text: str) -> bool:
        try:
            # Telegram caps messages at 4096 chars.
            _call(self.token, "sendMessage",
                  {"chat_id": chat_id, "text": text[:4096]}, timeout=20.0)
            return True
        except Exception as exc:
            log.warning("telegram send failed: %s", exc)
            return False

    async def run_loop(self, on_message: Callable[[str, int], Awaitable[None]]) -> None:
        """Poll forever; call on_message(text, chat_id) for each allowed message."""
        try:
            me = await asyncio.to_thread(_call, self.token, "getMe", {}, 15.0)
            if not me.get("ok"):
                log.warning("telegram token rejected — channel disabled")
                return
            log.info("telegram channel online as @%s", me["result"].get("username"))
        except Exception as exc:
            log.warning("telegram getMe failed (%s) — channel disabled", exc)
            return

        while True:
            try:
                updates = await asyncio.to_thread(
                    _call, self.token, "getUpdates",
                    {"offset": self._offset, "timeout": 30}, 35.0,
                )
            except asyncio.CancelledError:
                return
            except Exception as exc:
                log.debug("telegram poll error: %s", exc)
                await asyncio.sleep(5)
                continue

            for upd in updates.get("result", []):
                self._offset = upd["update_id"] + 1
                msg = upd.get("message") or upd.get("edited_message")
                if not msg:
                    continue
                chat_id = msg.get("chat", {}).get("id")
                text = (msg.get("text") or "").strip()
                if not text or chat_id is None:
                    continue
                if self.allowed_ids and chat_id not in self.allowed_ids:
                    log.info("telegram: ignoring message from unapproved chat %s", chat_id)
                    continue
                try:
                    await on_message(text, chat_id)
                except Exception:
                    log.exception("telegram handler error")


def from_env() -> TelegramChannel | None:
    """Build a TelegramChannel from environment, or None if not configured."""
    token = os.environ.get("JARVIS_TELEGRAM_TOKEN", "").strip()
    if not token:
        return None
    allowed_raw = os.environ.get("JARVIS_TELEGRAM_ALLOWED_IDS", "").strip()
    allowed = set()
    for part in allowed_raw.split(","):
        part = part.strip()
        if part.lstrip("-").isdigit():
            allowed.add(int(part))
    return TelegramChannel(token, allowed_ids=allowed)
