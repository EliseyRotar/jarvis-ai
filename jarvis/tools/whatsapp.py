"""WhatsApp Web automation tool for JARVIS.

Delegates to ~/.jarvis/automation/whatsapp_send.py which runs under
system Python (where playwright is installed), not the venv.
Contacts are stored in ~/.jarvis/whatsapp_contacts.json as
{"alias": "WhatsApp display name"}.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

from . import bash_exec

CONTACTS_FILE = Path.home() / ".jarvis" / "whatsapp_contacts.json"
WA_SCRIPT = Path.home() / ".jarvis" / "automation" / "whatsapp_send.py"
_SYSTEM_PYTHON = shutil.which("python3") or shutil.which("python") or sys.executable


def _load_contacts() -> dict[str, str]:
    if not CONTACTS_FILE.exists():
        return {}
    try:
        return json.loads(CONTACTS_FILE.read_text())
    except Exception:
        return {}


def _save_contacts(contacts: dict[str, str]) -> None:
    CONTACTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONTACTS_FILE.write_text(json.dumps(contacts, ensure_ascii=False, indent=2))


async def send(contact_alias: str, message: str) -> dict[str, Any]:
    """Send a WhatsApp message. contact_alias is looked up in the contacts book."""
    contacts = _load_contacts()

    # Resolve alias → WhatsApp display name (fallback: use the alias directly)
    wa_name = contacts.get(contact_alias.lower(), contact_alias)

    cmd = f'{_q(_SYSTEM_PYTHON)} {_q(str(WA_SCRIPT))} {_q(wa_name)} {_q(message)}'
    # WhatsApp Web's first-load "downloading messages" sync can take 20-40s,
    # plus browser launch and send time. 60s was too tight and truncated runs.
    result = await bash_exec.run(cmd, timeout=150)

    exit_code = result["exit_code"]
    ok = exit_code == 0
    # Exit code 2 from the automation script = not logged in / QR required.
    needs_login = exit_code == 2
    error = None
    if needs_login:
        error = ("WhatsApp Web is not logged in. Run the one-time setup "
                 "(whatsapp.setup) and scan the QR code with your phone.")
    elif not ok:
        error = result["stderr"].strip() or result["stdout"].strip() or "Send failed."

    return {
        "ok": ok,
        "contact": wa_name,
        "needs_login": needs_login,
        "error": error,
        "stdout": result["stdout"],
        "stderr": result["stderr"],
        "exit_code": exit_code,
    }


async def add_contact(alias: str, wa_display_name: str) -> dict[str, Any]:
    """Save a contact alias → WhatsApp display name mapping."""
    contacts = _load_contacts()
    contacts[alias.lower()] = wa_display_name
    _save_contacts(contacts)
    return {"ok": True, "alias": alias, "wa_name": wa_display_name}


async def list_contacts() -> dict[str, Any]:
    return {"ok": True, "contacts": _load_contacts()}


async def setup() -> dict[str, Any]:
    """Open WhatsApp Web for initial QR scan (run once)."""
    cmd = f'{_q(_SYSTEM_PYTHON)} {_q(str(WA_SCRIPT))} --setup'
    result = await bash_exec.run(cmd, timeout=180)
    return {"ok": result["exit_code"] == 0, "stdout": result["stdout"]}


def _q(s: str) -> str:
    """Shell-quote a string for the platform's default shell."""
    if os.name == "nt":
        # cmd.exe doesn't understand single quotes; use double quotes and
        # escape embedded double quotes.
        return '"' + s.replace('"', '\\"') + '"'
    import shlex
    return shlex.quote(s)
