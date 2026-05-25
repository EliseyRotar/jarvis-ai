"""Hyprland dispatch via hyprctl."""
from __future__ import annotations

import shlex
from typing import Any

from . import bash_exec


async def dispatch(dispatcher: str, args: str = "") -> dict[str, Any]:
    """Run `hyprctl dispatch <dispatcher> <args>`."""
    if not dispatcher:
        return {"ok": False, "error": "dispatcher is required"}
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
    cmd = f"hyprctl -j {shlex.quote(query)}"
    result = await bash_exec.run(cmd, timeout=10)
    return {
        "ok": result["exit_code"] == 0,
        "stdout": result["stdout"],
        "stderr": result["stderr"],
    }
