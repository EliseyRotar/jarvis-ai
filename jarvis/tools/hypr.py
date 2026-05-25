"""Hyprland dispatch via hyprctl.

Hyprland-only. On other compositors/desktops hyprctl is absent; the tools
return a clear, non-fatal error so JARVIS can fall back to plain `bash_exec`
(e.g. launching apps directly) instead of failing opaquely.
"""
from __future__ import annotations

import shlex
import shutil
from typing import Any

from . import bash_exec


def _hyprctl_available() -> bool:
    return shutil.which("hyprctl") is not None


_NO_HYPR_MSG = (
    "hyprctl not found — this system isn't running Hyprland. "
    "Use bash_exec to launch apps or control the desktop directly."
)


async def dispatch(dispatcher: str, args: str = "") -> dict[str, Any]:
    """Run `hyprctl dispatch <dispatcher> <args>`."""
    if not dispatcher:
        return {"ok": False, "error": "dispatcher is required"}
    if not _hyprctl_available():
        return {"ok": False, "error": _NO_HYPR_MSG, "available": False}
    safe_dispatcher = shlex.quote(dispatcher)
    # exec dispatcher: hyprland passes args as the command string verbatim.
    # Quote the entire args string so the shell doesn't split on spaces/colons.
    safe_args = shlex.quote(args) if args else ""
    cmd = f"hyprctl dispatch {safe_dispatcher} {safe_args}".strip()
    result = await bash_exec.run(cmd, timeout=10)
    return {
        "ok": result["exit_code"] == 0,
        "command": cmd,
        "stdout": result["stdout"],
        "stderr": result["stderr"],
        "exit_code": result["exit_code"],
    }


async def info(query: str = "activewindow") -> dict[str, Any]:
    """Fetch information from hyprctl (e.g. activewindow, workspaces, clients)."""
    if not _hyprctl_available():
        return {"ok": False, "error": _NO_HYPR_MSG, "available": False}
    cmd = f"hyprctl -j {shlex.quote(query)}"
    result = await bash_exec.run(cmd, timeout=10)
    return {
        "ok": result["exit_code"] == 0,
        "stdout": result["stdout"],
        "stderr": result["stderr"],
    }
