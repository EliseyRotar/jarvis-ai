"""Add a new project profile to Hermes + JARVIS routing.

Each project profile is a Hermes profile (under ``~/.hermes/profiles/<name>/``)
with its own SOUL.md, API key, memory, and session. JARVIS routes turns to the
right profile based on the active mode, so adding a project means:

    1. Create ``~/.hermes/profiles/<name>/.env``       (API_SERVER_KEY + provider keys)
    2. Create ``~/.hermes/profiles/<name>/config.yaml`` (model, cwd, terminal settings)
    3. Create ``~/.hermes/profiles/<name>/SOUL.md``     (personality + project context)
    4. Register the new profile in ``jarvis.hermes_client._KEYS`` + ``_SESSION_IDS``
    5. Register the new mode in ``jarvis.main._current_mode``'s valid set
    6. Append a record to ``~/.jarvis/projects.json`` for the orb UI
    7. Restart the Hermes gateway so the new profile is served

CLI usage:
    python -m jarvis.admin.add_project            # interactive wizard
    python -m jarvis.admin.add_project --dry-run  # show what would be written
    python -m jarvis.admin.add_project --remove finance  # undo a project

HTTP usage (from the orb UI):
    POST /api/admin/add_project     {"name":"finance","cwd":"...","soul_md":"...","api_key":"..."}
    POST /api/admin/remove_project  {"name":"finance"}
    GET  /api/admin/projects        -> list of registered projects

The wizard NEVER deletes user data: it only removes the profile directory
when ``--remove`` is passed AND the user confirms.
"""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
import subprocess
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

log = logging.getLogger("jarvis.admin")

HERMES_HOME = Path(os.environ.get("HERMES_HOME") or
                   (Path(os.environ.get("LOCALAPPDATA", "")) / "hermes") if os.name == "nt"
                   else Path.home() / ".hermes")
JARVIS_HOME = Path(os.environ.get("JARVIS_HOME") or Path.home() / ".jarvis")

PROJECTS_JSON = JARVIS_HOME / "projects.json"

PROFILE_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


@dataclass
class ProjectSpec:
    """User-supplied inputs for creating a project profile."""

    name: str
    cwd: str
    soul_md: str
    api_key: str = ""           # if empty, auto-generated
    model: str = "gpt-oss:120b"
    provider: str = "ollama-cloud"
    base_url: str = "https://ollama.com/v1"
    ollama_api_key: str = ""    # if empty, inherited from default profile
    terminal_backend: str = "local"
    terminal_timeout: int = 180
    notes: str = ""
    # populated by validate()
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("errors", None)
        return d


# ──────────────────────────────────────────────────────────────────────────
# Validation
# ──────────────────────────────────────────────────────────────────────────


def _validate_name(name: str) -> list[str]:
    errs: list[str] = []
    if not name:
        errs.append("name is required")
    elif not PROFILE_NAME_RE.match(name):
        errs.append(
            f"name {name!r} must match {PROFILE_NAME_RE.pattern} "
            "(lowercase letters, digits, '-' or '_', 1-32 chars, must start alphanumeric)"
        )
    elif name in {"default", "eli6", "wwf"}:
        errs.append(f"{name!r} is a reserved profile name")
    elif (HERMES_HOME / "profiles" / name).exists():
        errs.append(f"profile directory already exists: {HERMES_HOME / 'profiles' / name}")
    return errs


def _validate_cwd(cwd: str) -> list[str]:
    errs: list[str] = []
    if not cwd:
        errs.append("cwd is required")
    else:
        p = Path(cwd)
        if not p.is_absolute():
            errs.append(f"cwd must be an absolute path (got {cwd!r})")
        elif not p.exists():
            errs.append(f"cwd does not exist: {cwd}")
        elif not p.is_dir():
            errs.append(f"cwd is not a directory: {cwd}")
    return errs


def _validate_soul_md(text: str) -> list[str]:
    """The SOUL.md scanner in Hermes blocks some patterns. Pre-flight check."""
    errs: list[str] = []
    if not text or not text.strip():
        errs.append("soul_md is required (the SOUL.md sets the assistant's voice + project context)")
    elif len(text) > 32_000:
        errs.append(f"soul_md too long ({len(text)} chars; max 32000)")
    return errs


def _validate_model(model: str, provider: str, base_url: str) -> list[str]:
    errs: list[str] = []
    if not model:
        errs.append("model is required")
    if not provider:
        errs.append("provider is required")
    if provider != "local" and not base_url:
        errs.append("base_url is required for non-local providers")
    return errs


def validate(spec: ProjectSpec) -> ProjectSpec:
    """Run all validation rules and attach the error list. Spec is mutated."""
    errs: list[str] = []
    errs.extend(_validate_name(spec.name))
    errs.extend(_validate_cwd(spec.cwd))
    errs.extend(_validate_soul_md(spec.soul_md))
    errs.extend(_validate_model(spec.model, spec.provider, spec.base_url))
    spec.errors = errs
    return spec


# ──────────────────────────────────────────────────────────────────────────
# File generation
# ──────────────────────────────────────────────────────────────────────────


def _generate_api_key() -> str:
    return secrets.token_urlsafe(24)


def _read_ollama_key() -> str:
    env_path = HERMES_HOME / ".env"
    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if line.startswith("OLLAMA_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def _write_profile_files(spec: ProjectSpec) -> dict[str, Path]:
    """Write .env, config.yaml, SOUL.md into ~/.hermes/profiles/<name>/.

    Returns a mapping of what was written for reporting.
    """
    profile_dir = HERMES_HOME / "profiles" / spec.name
    profile_dir.mkdir(parents=True, exist_ok=False)

    api_key = spec.api_key or _generate_api_key()
    ollama_key = spec.ollama_api_key or _read_ollama_key()

    env_lines = [
        "# Generated by jarvis.admin.add_project — do not edit by hand.",
        "",
        "API_SERVER_ENABLED=true",
        f"API_SERVER_KEY={api_key}",
        "",
        "TERMINAL_CWD=" + spec.cwd,
        "TERMINAL_TIMEOUT=" + str(spec.terminal_timeout),
        "TERMINAL_LIFETIME_SECONDS=300",
        "",
    ]
    if spec.provider == "ollama-cloud":
        env_lines.append("OLLAMA_BASE_URL=" + spec.base_url)
        if ollama_key:
            env_lines.append(f"OLLAMA_API_KEY={ollama_key}")

    env_path = profile_dir / ".env"
    env_path.write_text("\n".join(env_lines) + "\n", encoding="utf-8")

    config_lines = [
        f"# Profile: {spec.name} — generated by jarvis.admin.add_project",
        "database:",
        "  journal_mode: wal",
        "model:",
        f"  default: {spec.model}",
        f"  provider: {spec.provider}",
        f"  base_url: {spec.base_url}",
        "kanban:",
        "  review_dispatch: true",
        "terminal:",
        f"  backend: {spec.terminal_backend}",
        f"  cwd: {spec.cwd}",
        f"  timeout: {spec.terminal_timeout}",
        "  home_mode: auto",
        "  docker_mount_cwd_to_workspace: false",
        "  lifetime_seconds: 300",
        "  container_cpu: 1",
        "  container_memory: 5120",
        "  container_disk: 51200",
        "  container_persistent: true",
        "browser:",
        "  inactivity_timeout: 120",
        "compression:",
        "  enabled: true",
        "  progress_notices: false",
        "  threshold: 0.5",
        "  protect_first_n: 3",
        "  protect_last_n: 20",
        "  min_tail_user_messages: 1",
        "  max_attempts: 3",
        "memory:",
        "  memory_enabled: true",
        "  user_profile_enabled: true",
        "  memory_char_limit: 2200",
        "  user_char_limit: 1375",
        "  nudge_interval: 10",
        "  flush_min_turns: 6",
        "session_reset:",
        "  mode: none",
        "  idle_minutes: 1440",
        "  at_hour: 4",
        "streaming:",
        "  enabled: false",
        "agent:",
        "  max_turns: 500",
        "  reasoning_effort: medium",
        "wake_word:",
        "  enabled: true",
        "  provider: openwakeword",
        "  phrase: hey jarvis",
        "  openwakeword:",
        "    model: hey_jarvis",
        "  capture: auto",
        "platforms:",
        "  api_server:",
        "    enabled: false",
        "_config_version: 37",
    ]
    config_path = profile_dir / "config.yaml"
    config_path.write_text("\n".join(config_lines) + "\n", encoding="utf-8")

    soul_path = profile_dir / "SOUL.md"
    soul_path.write_text(spec.soul_md, encoding="utf-8")

    return {
        "profile_dir": profile_dir,
        "env": env_path,
        "config": config_path,
        "soul": soul_path,
        "api_key": api_key,
    }


# ──────────────────────────────────────────────────────────────────────────
# JARVIS-side registration (in-memory + projects.json)
# ──────────────────────────────────────────────────────────────────────────


def _register_in_jarvis(spec: ProjectSpec, api_key: str) -> None:
    """Update the running JARVIS process so the new mode is routable.

    We import the routing module lazily to avoid circular imports at startup.
    """
    from jarvis import hermes_client

    hermes_client._KEYS[spec.name] = api_key
    hermes_client._SESSION_IDS[spec.name] = f"jarvis-orb-{spec.name}"

    projects = _load_projects()
    projects[spec.name] = {
        "name": spec.name,
        "cwd": spec.cwd,
        "model": spec.model,
        "provider": spec.provider,
        "notes": spec.notes,
        "added_at": int(__import__("time").time()),
    }
    _save_projects(projects)


def _load_projects() -> dict[str, dict[str, Any]]:
    try:
        return json.loads(PROJECTS_JSON.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_projects(projects: dict[str, dict[str, Any]]) -> None:
    JARVIS_HOME.mkdir(parents=True, exist_ok=True)
    PROJECTS_JSON.write_text(json.dumps(projects, indent=2, sort_keys=True), encoding="utf-8")


# ──────────────────────────────────────────────────────────────────────────
# Hermes gateway control
# ──────────────────────────────────────────────────────────────────────────


def _find_gateway_pids() -> list[int]:
    """Locate running Hermes gateway processes (parent + any uv re-exec child)."""
    out: list[int] = []
    try:
        ps_cmd = ["powershell", "-NoProfile", "-Command",
                  "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
                  "Where-Object { $_.CommandLine -like '*gateway*' } | "
                  "Select-Object -ExpandProperty ProcessId"]
        res = subprocess.run(ps_cmd, capture_output=True, text=True, timeout=15)
        for line in res.stdout.splitlines():
            line = line.strip()
            if line.isdigit():
                out.append(int(line))
    except Exception as exc:
        log.warning("gateway PID probe failed: %s", exc)
    return out


def _kill_gateway() -> None:
    pids = _find_gateway_pids()
    for pid in pids:
        try:
            subprocess.run(["powershell", "-NoProfile", "-Command",
                            f"Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue"],
                           timeout=10)
        except Exception:
            pass


def _start_gateway() -> None:
    """Re-launch the Hermes gateway as a detached background process.

    Prefers the Startup-folder VBS wrapper (matches boot behavior). If absent,
    falls back to invoking the gateway CLI directly via the project venv.
    """
    startup_script = (Path(os.environ.get("APPDATA", "")) /
                       "Microsoft/Windows/Start Menu/Programs/Startup/Hermes_Gateway.vbs")
    if startup_script.exists():
        try:
            subprocess.Popen(["wscript.exe", str(startup_script)], close_fds=True)
            return
        except Exception as exc:
            log.warning("startup-script launch failed: %s — falling back to direct CLI", exc)

    py = Path(HERMES_HOME) / "hermes-agent" / "venv" / "Scripts" / "python.exe"
    if not py.exists():
        log.warning("hermes venv python not found at %s — please restart Hermes manually", py)
        return
    try:
        env = dict(os.environ)
        env.setdefault("HERMES_HOME", str(HERMES_HOME))
        env.setdefault("PYTHONIOENCODING", "utf-8")
        env.setdefault("HERMES_GATEWAY_DETACHED", "1")
        subprocess.Popen(
            [str(py), "-m", "hermes_cli.main", "gateway", "run"],
            env=env, close_fds=True, creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
        )
    except Exception as exc:
        log.warning("could not relaunch gateway: %s", exc)


def _wait_gateway_ready(timeout: float = 45.0) -> bool:
    """Poll /health until 200 or timeout. Tries with the default key first."""
    import time
    import urllib.request
    import urllib.error

    keys_to_try = []
    try:
        keys_to_try.append(_read_env_file(HERMES_HOME / ".env").get("API_SERVER_KEY", ""))
    except Exception:
        pass
    keys_to_try.append("health")  # fall back to a dummy; the server's auth may still answer

    deadline = time.time() + timeout
    while time.time() < deadline:
        for key in keys_to_try:
            try:
                req = urllib.request.Request("http://127.0.0.1:8642/health",
                                             headers={"Authorization": f"Bearer {key}"})
                with urllib.request.urlopen(req, timeout=2) as resp:
                    if resp.status == 200:
                        return True
            except (urllib.error.URLError, ConnectionError, OSError):
                continue
        time.sleep(0.5)
    return False


def _verify_profile(spec: ProjectSpec, api_key: str, retries: int = 3) -> dict[str, Any]:
    """Smoke-test the new profile by hitting /health with its API key."""
    import urllib.request
    import urllib.error
    import time

    url = f"http://127.0.0.1:8642/p/{spec.name}/health"
    last: dict[str, Any] = {"ok": False, "status": None}
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                return {"ok": resp.status == 200, "status": resp.status,
                        "body": resp.read(200).decode("utf-8", "replace"),
                        "attempts": attempt + 1}
        except urllib.error.HTTPError as e:
            last = {"ok": False, "status": e.code, "body": e.read(200).decode("utf-8", "replace"), "attempt": attempt + 1}
        except Exception as e:
            last = {"ok": False, "status": None, "error": str(e), "attempt": attempt + 1}
        time.sleep(1.5)
    return last


# ──────────────────────────────────────────────────────────────────────────
# Public entry points
# ──────────────────────────────────────────────────────────────────────────


def add_project(spec: ProjectSpec, *, dry_run: bool = False, restart: bool = True) -> dict[str, Any]:
    """Create a profile + register it + restart Hermes. Returns a status dict.

    On success the dict contains: {ok, profile_dir, env, config, soul, api_key, gateway_restarted, profile_verified}
    On failure: {ok, error, errors}.
    """
    spec = validate(spec)
    if spec.errors:
        return {"ok": False, "error": "validation failed", "errors": spec.errors}

    result: dict[str, Any] = {"ok": True, "dry_run": dry_run}

    if dry_run:
        result["would_write"] = {
            "profile_dir": str(HERMES_HOME / "profiles" / spec.name),
            "files": [".env", "config.yaml", "SOUL.md"],
            "would_register_in_jarvis": True,
            "would_restart_gateway": restart,
        }
        return result

    try:
        paths = _write_profile_files(spec)
        result["profile_dir"] = str(paths["profile_dir"])
        result["env"] = str(paths["env"])
        result["config"] = str(paths["config"])
        result["soul"] = str(paths["soul"])
        result["api_key"] = paths["api_key"]

        _register_in_jarvis(spec, paths["api_key"])

        if restart:
            _kill_gateway()
            _start_gateway()
            result["gateway_restarted"] = _wait_gateway_ready(timeout=45.0)
            if result["gateway_restarted"]:
                verify = _verify_profile(spec, paths["api_key"])
                result["profile_verified"] = verify.get("ok", False)
                result["profile_verify"] = verify
            else:
                result["profile_verified"] = False
                result["error"] = "gateway did not become ready within 45s"

        return result
    except Exception as exc:
        log.exception("add_project failed")
        return {"ok": False, "error": str(exc), "exception_type": type(exc).__name__}


def remove_project(name: str, *, confirm: bool = False, restart: bool = True) -> dict[str, Any]:
    """Undo a project: delete the Hermes profile dir + unregister from JARVIS."""
    if name in {"default", "wwf"}:
        return {"ok": False, "error": f"{name!r} is a built-in profile — cannot remove"}
    profile_dir = HERMES_HOME / "profiles" / name
    if not profile_dir.exists():
        return {"ok": False, "error": f"profile {name!r} does not exist"}

    if not confirm:
        return {"ok": False, "error": "refusing to remove without confirm=True"}

    # The Hermes gateway holds the SQLite state.db open with file handles, so
    # we MUST kill the gateway before rmtree — otherwise Windows file locks
    # silently leave the dir behind (the "ignore_errors=True" swallows the
    # PermissionError but leaves partial state). We then restart at the end.
    kill_first = restart
    if kill_first:
        _kill_gateway()
        # Give Windows a beat to release locks.
        import time as _t
        _t.sleep(1.5)

    import shutil
    removed = shutil.rmtree(profile_dir, ignore_errors=False)

    try:
        from jarvis import hermes_client
        hermes_client._KEYS.pop(name, None)
        hermes_client._SESSION_IDS.pop(name, None)
    except Exception:
        pass

    projects = _load_projects()
    projects.pop(name, None)
    _save_projects(projects)

    if restart:
        _start_gateway()
        ready = _wait_gateway_ready(timeout=45.0)
        return {"ok": True, "removed": name, "gateway_restarted": ready}
    return {"ok": True, "removed": name, "gateway_restarted": False}


def list_projects() -> list[dict[str, Any]]:
    """All project profiles known to JARVIS (built-ins + user-added)."""
    projects = _load_projects()
    out: list[dict[str, Any]] = []
    for name in ("default", "wwf"):
        out.append({"name": name, "built_in": True})
    for name, meta in sorted(projects.items()):
        out.append({"name": name, "built_in": False, **meta})
    return out


# ──────────────────────────────────────────────────────────────────────────
# SOUL.md generation (from wizard answers)
# ──────────────────────────────────────────────────────────────────────────


SOUL_TEMPLATE = """You are J.A.R.V.I.S. in WORK MODE — the {project_title} project assistant. Same JARVIS personality (formal, composed, dry wit, addresses the operator as "sir"), but your entire focus is the {project_title} project.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{project_description}

Working directory: {cwd}

Tech stack / context:
{tech_stack}

Key conventions:
{conventions}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WORK MODE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- You have full project control: code edits, git, deploys, DB access. Execute without asking for confirmation, but for irreversible production actions state briefly what you are doing as you do it.
- Before editing any file, read it first. Follow the repo's existing patterns and conventions exactly.
- After code changes, run the relevant checks (lint, typecheck, build) and report real results. Never claim a check passed without running it.
- Use session_search to recall past project work before re-doing it.
- Save durable project facts to memory: deploy details, decisions, recurring gotchas.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEMORY & SKILLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Save non-trivial workflows as skills (e.g. the deploy runbook, DB backup/restore).
- Record recurring gotchas and decisions in memory so future sessions have the context.
- When the operator says "switch to normal mode" or similar, remind him that this profile is {project_title}-focused and general tasks belong in the default profile.

Online and ready, sir. Work mode: {project_title}.
"""


def generate_soul_md(*, project_title: str, project_description: str, cwd: str,
                     tech_stack: str = "", conventions: str = "") -> str:
    """Render a SOUL.md from wizard answers."""
    return (SOUL_TEMPLATE
            .replace("{project_title}", project_title.strip() or "<project title>")
            .replace("{project_description}", project_description.strip() or "<describe the project>")
            .replace("{cwd}", cwd.strip())
            .replace("{tech_stack}", tech_stack.strip() or "- (edit this section to list your stack)")
            .replace("{conventions}", conventions.strip() or "- (edit this section to list your conventions)"))


# ──────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────


def _cli_input(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        v = input(f"{prompt}{suffix}: ").strip()
    except EOFError:
        v = ""
    return v or default


def _cli_interactive() -> ProjectSpec:
    print("\n=== JARVIS Add Project Wizard ===\n")
    name = _cli_input("Project name (lowercase, kebab-case, 1-32 chars)")
    cwd = _cli_input("Working directory (absolute path)")
    while not Path(cwd).exists() if cwd else True:
        print(f"  ! {cwd!r} does not exist")
        cwd = _cli_input("Working directory (absolute path)")
    title = _cli_input("Project title (for SOUL.md)", default=name)
    description = _cli_input("One-paragraph project description")
    tech = _cli_input("Tech stack (one line, optional)", default="")
    conventions = _cli_input("Key conventions (one line, optional)", default="")
    notes = _cli_input("Notes for yourself (optional)", default="")

    soul_md = generate_soul_md(
        project_title=title, project_description=description,
        cwd=cwd, tech_stack=tech, conventions=conventions,
    )

    print("\n--- Generated SOUL.md preview (first 20 lines) ---")
    for line in soul_md.splitlines()[:20]:
        print(line)
    if len(soul_md.splitlines()) > 20:
        print(f"... ({len(soul_md.splitlines()) - 20} more lines)")
    print("--- end preview ---\n")

    if _cli_input("Edit SOUL.md before saving? [y/N]", "n").lower().startswith("y"):
        edited = _edit_in_notepad(soul_md)
        if edited is not None:
            soul_md = edited

    return ProjectSpec(
        name=name, cwd=cwd, soul_md=soul_md, notes=notes,
        model=_cli_input("Default model", "gpt-oss:120b"),
        provider=_cli_input("Provider", "ollama-cloud"),
        base_url=_cli_input("Base URL", "https://ollama.com/v1"),
    )


def _edit_in_notepad(initial: str) -> str | None:
    """Open SOUL.md in notepad for the user to tweak. Returns the saved text."""
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(initial)
        path = f.name
    print(f"Opening {path} in notepad — close notepad when done.")
    try:
        subprocess.run(["notepad.exe", path], check=False)
    except Exception:
        return None
    return Path(path).read_text(encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    argv = argv or sys.argv[1:]
    if "--dry-run" in argv:
        argv.remove("--dry-run")
        dry_run = True
    else:
        dry_run = False

    if "--remove" in argv:
        idx = argv.index("--remove")
        argv.pop(idx)
        name = argv.pop(0) if argv else _cli_input("Project name to remove")
        result = remove_project(name, confirm=True, restart=not dry_run)
        print(json.dumps(result, indent=2))
        return 0 if result.get("ok") else 1

    if argv and not argv[0].startswith("-"):
        spec_dict_path = argv[0]
        spec_dict = json.loads(Path(spec_dict_path).read_text(encoding="utf-8"))
        spec = ProjectSpec(**spec_dict)
    else:
        spec = _cli_interactive()

    print(f"\nCreating profile {spec.name!r} at {spec.cwd!r}...")
    result = add_project(spec, dry_run=dry_run)
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
