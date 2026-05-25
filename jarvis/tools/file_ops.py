"""File read / write / delete operations."""
from __future__ import annotations

import base64
import os
import shutil
from typing import Any


def _expand(path: str) -> str:
    return os.path.expanduser(os.path.expandvars(path))


async def read(path: str, encoding: str = "utf-8") -> dict[str, Any]:
    """Read a file. Encoding may be 'utf-8' or 'binary' (returns base64)."""
    full = _expand(path)
    if not os.path.exists(full):
        return {"ok": False, "error": f"file not found: {full}"}
    if os.path.isdir(full):
        return {"ok": False, "error": f"path is a directory: {full}"}
    try:
        if encoding == "binary":
            with open(full, "rb") as f:
                data = f.read()
            return {"ok": True, "path": full, "content_b64": base64.b64encode(data).decode("ascii"), "bytes": len(data)}
        with open(full, "r", encoding=encoding, errors="replace") as f:
            content = f.read()
        return {"ok": True, "path": full, "content": content, "chars": len(content)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


async def write(path: str, content: str, append: bool = False) -> dict[str, Any]:
    """Write content to a file. Creates parent dirs as needed."""
    full = _expand(path)
    try:
        parent = os.path.dirname(full)
        if parent:
            os.makedirs(parent, exist_ok=True)
        mode = "a" if append else "w"
        with open(full, mode, encoding="utf-8") as f:
            f.write(content)
        return {"ok": True, "path": full, "bytes_written": len(content.encode("utf-8")), "appended": append}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


async def delete(path: str, recursive: bool = False) -> dict[str, Any]:
    """Delete a file or directory."""
    full = _expand(path)
    if not os.path.exists(full):
        return {"ok": False, "error": f"path not found: {full}"}
    try:
        if os.path.isdir(full):
            if recursive:
                shutil.rmtree(full)
            else:
                os.rmdir(full)
            return {"ok": True, "path": full, "kind": "dir"}
        os.remove(full)
        return {"ok": True, "path": full, "kind": "file"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
