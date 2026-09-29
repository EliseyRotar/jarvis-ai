"""Screen capture for the activity UI (Phase 3).

Cosmo shows what it is doing: every tool_call can be accompanied by a
downscaled screenshot of the user's screen, captured server-side and pushed
over the WebSocket as ``{type: 'screenshot', for: <tool_call_id>, data: <b64>}``
so the floating action card / right rail can show visual proof of the action.

Rate-limited to one capture per second: busy tool loops (dozens of calls)
stay cheap, and bursts collapse to a single grab.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import time

log = logging.getLogger("jarvis.screenshot")

_MIN_INTERVAL = 1.0
_last = 0.0
_lock = asyncio.Lock()


def _grab_jpeg(max_width: int, quality: int) -> str:
    from PIL import Image, ImageGrab

    img = ImageGrab.grab()
    if img.width > max_width:
        ratio = max_width / img.width
        resample = getattr(Image, "Resampling", Image).LANCZOS
        img = img.resize((max_width, max(1, int(img.height * ratio))), resample=resample)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


async def capture_jpeg(max_width: int = 640, quality: int = 55) -> str | None:
    """Base64 JPEG of the primary screen, or None when rate-limited/failed."""
    global _last
    async with _lock:
        now = time.monotonic()
        if now - _last < _MIN_INTERVAL:
            return None
        _last = now
    try:
        return await asyncio.to_thread(_grab_jpeg, max_width, quality)
    except Exception as exc:  # noqa: BLE001 — capture is best-effort decoration
        log.debug("screenshot capture failed: %s", exc)
        return None
