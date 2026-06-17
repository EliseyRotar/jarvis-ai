"""Simple Telegram bot channel for JARVIS.

Verifies a bot token with the Telegram /getMe API and stores the config so the
web UI can show connection status. Config stored in ~/.jarvis/telegram.json:
  {"token": "...", "username": "...", "first_name": "..."}

Full message-relay/polling loop is intentionally not implemented here — that
requires careful async lifetime management integrated with the JARVIS LLM
pipeline and is left as a follow-up.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

TELEGRAM_CONFIG_PATH = Path.home() / ".jarvis" / "telegram.json"


def load_config() -> dict[str, Any]:
    """Load the Telegram bot config from disk, returning {} if missing."""
    if TELEGRAM_CONFIG_PATH.exists():
        try:
            return json.loads(TELEGRAM_CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_config(cfg: dict[str, Any]) -> None:
    """Persist the Telegram bot config to disk."""
    TELEGRAM_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    TELEGRAM_CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


async def get_bot_info(token: str) -> dict[str, Any]:
    """Call the Telegram /getMe endpoint to verify *token* and return bot info.

    Returns:
        {"ok": True, "username": "...", "first_name": "..."}  on success
        {"ok": False, "error": "..."}                         on failure
    """
    import aiohttp

    url = f"https://api.telegram.org/bot{token}/getMe"
    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                data: dict[str, Any] = await resp.json()
                if data.get("ok"):
                    result = data.get("result", {})
                    return {
                        "ok": True,
                        "username": result.get("username", ""),
                        "first_name": result.get("first_name", ""),
                    }
                return {
                    "ok": False,
                    "error": data.get("description", "Invalid token"),
                }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
