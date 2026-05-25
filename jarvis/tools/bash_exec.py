"""Bash execution with timeout and stdout/stderr capture."""
from __future__ import annotations

import asyncio
import os
from typing import Any


DEFAULT_TIMEOUT = 120  # seconds
MAX_OUTPUT_CHARS = 16_000


def _truncate(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... [truncated {len(text) - limit} chars]"


async def run(
    command: str,
    cwd: str | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Execute a shell command and return stdout / stderr / exit_code."""
    if not command or not command.strip():
        return {"stdout": "", "stderr": "empty command", "exit_code": -1}

    workdir = os.path.expanduser(cwd) if cwd else None
    if workdir and not os.path.isdir(workdir):
        return {
            "stdout": "",
            "stderr": f"cwd does not exist: {workdir}",
            "exit_code": -1,
        }

    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workdir,
            env={**os.environ, "PAGER": "cat", "GIT_PAGER": "cat"},
        )
    except Exception as exc:
        return {"stdout": "", "stderr": f"spawn failed: {exc}", "exit_code": -1}

    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        return {
            "stdout": "",
            "stderr": f"command timed out after {timeout}s",
            "exit_code": -1,
        }

    return {
        "stdout": _truncate(stdout_b.decode("utf-8", errors="replace")),
        "stderr": _truncate(stderr_b.decode("utf-8", errors="replace")),
        "exit_code": proc.returncode if proc.returncode is not None else -1,
    }


# Synchronous adapter for callers that need it.
def run_sync(command: str, cwd: str | None = None, timeout: int = DEFAULT_TIMEOUT) -> dict[str, Any]:
    return asyncio.run(run(command, cwd=cwd, timeout=timeout))
