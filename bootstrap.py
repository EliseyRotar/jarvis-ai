#!/usr/bin/env python3
"""JARVIS bootstrap — single entry point for Linux and Windows.

Pure standard-library. Run with the system Python:

    python3 bootstrap.py        (Linux/macOS)
    python  bootstrap.py        (Windows)

On first run it serves a setup wizard on http://127.0.0.1:8765 that:
  - creates the venv and installs all dependencies (live log streamed to the page)
  - lets you choose & configure the AI backend (Claude Pro / OpenRouter / Ollama)
  - lets you pick STT/TTS options and download piper voices
  - writes ~/.jarvis/.env and a personalized system prompt
  - then launches the real JARVIS app on the same port

On subsequent runs (env already configured + venv ready) it skips straight to
launching JARVIS.
"""
from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IS_WINDOWS = platform.system() == "Windows"
JARVIS_DIR = Path.home() / ".jarvis"
ENV_FILE = JARVIS_DIR / ".env"
VENV = ROOT / ".venv"
PORT = int(os.environ.get("JARVIS_PORT", "8765"))

if IS_WINDOWS:
    VENV_PY = VENV / "Scripts" / "python.exe"
    VENV_UVICORN = VENV / "Scripts" / "uvicorn.exe"
else:
    VENV_PY = VENV / "bin" / "python"
    VENV_UVICORN = VENV / "bin" / "uvicorn"


# ──────────────────────────────────────────────────────────────────────────
# Shared log stream (server-sent events)
# ──────────────────────────────────────────────────────────────────────────

_log_lines: list[str] = []
_log_lock = threading.Lock()
_log_cv = threading.Condition(_log_lock)
_state = {"installing": False, "install_done": False, "install_error": None,
          "launching": False, "launched": False}


def log(msg: str) -> None:
    print(msg, flush=True)
    with _log_cv:
        _log_lines.append(msg)
        _log_cv.notify_all()


def run_streamed(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> int:
    log(f"$ {' '.join(str(c) for c in cmd)}")
    try:
        proc = subprocess.Popen(
            cmd, cwd=str(cwd) if cwd else None, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
    except Exception as exc:
        log(f"  ! failed to start: {exc}")
        return -1
    assert proc.stdout is not None
    for line in proc.stdout:
        log(line.rstrip())
    return proc.wait()


# ──────────────────────────────────────────────────────────────────────────
# Distro / package-manager detection (Linux only)
# ──────────────────────────────────────────────────────────────────────────

def detect_pkg_install() -> list[str] | None:
    for mgr, cmd in [
        ("pacman", ["sudo", "-n", "pacman", "-S", "--noconfirm", "--needed"]),
        ("apt",    ["sudo", "-n", "apt-get", "install", "-y"]),
        ("dnf",    ["sudo", "-n", "dnf", "install", "-y"]),
        ("zypper", ["sudo", "-n", "zypper", "install", "-y"]),
        ("apk",    ["sudo", "-n", "apk", "add"]),
    ]:
        if shutil.which(mgr):
            return cmd
    return None


def try_install_system_packages() -> None:
    """Best-effort install of piper/ffmpeg via the system package manager.

    Uses passwordless sudo only; if that's unavailable, logs instructions
    instead of blocking on a password prompt.
    """
    if IS_WINDOWS:
        if not (shutil.which("ffplay") or shutil.which("mpv")):
            log("  No audio player found — installing ffmpeg via winget (this can take a minute)...")
            if shutil.which("winget"):
                rc = run_streamed([
                    "winget", "install", "--id", "Gyan.FFmpeg", "-e",
                    "--source", "winget", "--accept-source-agreements",
                    "--accept-package-agreements", "--silent",
                ])
                if rc != 0:
                    log("  ! winget install of ffmpeg failed — install manually: winget install ffmpeg")
                else:
                    log("  ffmpeg installed. You may need to restart the terminal for PATH changes to apply.")
            else:
                log("  ! winget not found — install ffmpeg or mpv manually.")

        download_piper_binary_windows()
        return

    missing = []
    if not (shutil.which("piper") or shutil.which("piper-tts")):
        missing.append("piper")
    if not (shutil.which("ffplay") or shutil.which("mpv")):
        missing.append("ffmpeg")
    if not missing:
        return

    pkg_cmd = detect_pkg_install()
    if pkg_cmd is None:
        log(f"  ! Missing packages: {', '.join(missing)} — install them with your package manager.")
        return

    pkg_names = {
        "piper":  "piper-tts" if pkg_cmd[2] == "pacman" else "piper",
        "ffmpeg": "ffmpeg",
    }
    pkgs = [pkg_names[m] for m in missing]
    log(f"  Attempting to install: {', '.join(pkgs)} (requires passwordless sudo)")
    rc = run_streamed([*pkg_cmd, *pkgs])
    if rc != 0:
        log(f"  ! Could not auto-install {', '.join(pkgs)} — install manually if needed.")


# ──────────────────────────────────────────────────────────────────────────
# Install pipeline
# ──────────────────────────────────────────────────────────────────────────

def venv_ready() -> bool:
    return VENV_UVICORN.exists()


def run_install() -> None:
    _state["installing"] = True
    try:
        log("=== JARVIS setup starting ===")
        log(f"OS: {platform.system()} {platform.release()}  Python: {sys.version.split()[0]}")

        if not VENV_PY.exists():
            log("Creating virtual environment...")
            rc = run_streamed([sys.executable, "-m", "venv", str(VENV)])
            if rc != 0:
                _state["install_error"] = "venv creation failed"
                return

        log("Upgrading pip...")
        run_streamed([str(VENV_PY), "-m", "pip", "install", "--upgrade", "pip"])

        log("Installing JARVIS and core dependencies (this can take a few minutes)...")
        rc = run_streamed([str(VENV_PY), "-m", "pip", "install", "-e", str(ROOT)])
        if rc != 0:
            _state["install_error"] = "pip install failed"
            return

        log("Installing optional extras (wake word, WhatsApp)...")
        for extra in ("wakeword", "whatsapp"):
            rc = run_streamed([str(VENV_PY), "-m", "pip", "install", "-e", f"{ROOT}[{extra}]"])
            if rc != 0:
                log(f"  ! optional extra '{extra}' failed to install — related features will be unavailable.")

        log("Checking for piper / audio player...")
        try_install_system_packages()

        JARVIS_DIR.mkdir(parents=True, exist_ok=True)
        log("=== Install complete ===")
        _state["install_done"] = True
    except Exception as exc:
        log(f"! Install error: {exc}")
        _state["install_error"] = str(exc)
    finally:
        _state["installing"] = False


# ──────────────────────────────────────────────────────────────────────────
# Ollama model discovery
# ──────────────────────────────────────────────────────────────────────────

def list_ollama_models() -> list[str]:
    if not shutil.which("ollama"):
        return []
    try:
        out = subprocess.run(["ollama", "list"], capture_output=True, text=True, timeout=5)
        lines = out.stdout.strip().splitlines()[1:]  # skip header
        return [ln.split()[0] for ln in lines if ln.strip()]
    except Exception:
        return []


# ──────────────────────────────────────────────────────────────────────────
# Hardware detection
# ──────────────────────────────────────────────────────────────────────────

def _ram_gb() -> float | None:
    try:
        if IS_WINDOWS:
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            return round(stat.ullTotalPhys / (1024 ** 3), 1)
        else:
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        kb = int(line.split()[1])
                        return round(kb / (1024 ** 2), 1)
    except Exception:
        return None
    return None


def _gpu_names() -> list[str]:
    try:
        if shutil.which("nvidia-smi"):
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=5,
            )
            gpus = [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
            if gpus:
                return gpus
    except Exception:
        pass
    try:
        if IS_WINDOWS:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "(Get-CimInstance Win32_VideoController).Name"],
                capture_output=True, text=True, timeout=10,
            )
            gpus = [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
            if gpus:
                return gpus
        else:
            out = subprocess.run(["lspci"], capture_output=True, text=True, timeout=5)
            gpus = [ln.split(": ", 1)[1] for ln in out.stdout.splitlines()
                    if "VGA" in ln or "3D controller" in ln]
            if gpus:
                return gpus
    except Exception:
        pass
    return []


def detect_hardware() -> dict:
    cpu = platform.processor() or platform.uname().processor or platform.machine()
    if IS_WINDOWS:
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "(Get-CimInstance Win32_Processor).Name"],
                capture_output=True, text=True, timeout=10,
            )
            name = out.stdout.strip().splitlines()
            if name:
                cpu = name[0].strip()
        except Exception:
            pass
    else:
        try:
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if line.lower().startswith("model name"):
                        cpu = line.split(":", 1)[1].strip()
                        break
        except Exception:
            pass

    ram = _ram_gb()
    gpus = _gpu_names()
    cores = os.cpu_count() or 0

    parts = []
    if cpu:
        parts.append(cpu)
    if cores:
        parts.append(f"{cores} threads")
    if ram:
        parts.append(f"{ram} GB RAM")
    if gpus:
        parts.append(", ".join(gpus))

    return {
        "cpu": cpu, "cores": cores, "ram_gb": ram, "gpus": gpus,
        "summary": ", ".join(parts) if parts else "",
    }


# ──────────────────────────────────────────────────────────────────────────
# Credential verification
# ──────────────────────────────────────────────────────────────────────────

def verify_claude_token(token: str) -> dict:
    if not token.strip():
        return {"ok": False, "message": "No token provided"}
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps({
            "model": "claude-haiku-4-5",
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}],
        }).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token.strip()}",
            "anthropic-beta": "oauth-2025-04-20",
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
            return {"ok": True, "message": "Token is valid"}
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            return {"ok": False, "message": "Invalid or expired token (401 Unauthorized)"}
        if exc.code == 403:
            return {"ok": False, "message": "Token rejected (403 Forbidden)"}
        if exc.code in (200, 400, 429):
            return {"ok": True, "message": "Token is valid"}
        return {"ok": True, "message": f"Token accepted (HTTP {exc.code})"}
    except Exception as exc:
        return {"ok": False, "message": f"Could not reach Anthropic API: {exc}"}


def verify_openrouter_key(key: str) -> dict:
    if not key.strip():
        return {"ok": False, "message": "No API key provided"}
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/auth/key",
        headers={"Authorization": f"Bearer {key.strip()}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
            return {"ok": True, "message": "API key is valid"}
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            return {"ok": False, "message": "Invalid API key (401 Unauthorized)"}
        return {"ok": False, "message": f"Key rejected (HTTP {exc.code})"}
    except Exception as exc:
        return {"ok": False, "message": f"Could not reach OpenRouter API: {exc}"}


# ──────────────────────────────────────────────────────────────────────────
# Config writing
# ──────────────────────────────────────────────────────────────────────────

def _read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if ENV_FILE.exists():
        for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"')
    return env


def download_piper_binary_windows() -> Path | None:
    """Download the piper.exe release bundle for Windows and unpack it."""
    if shutil.which("piper"):
        return Path(shutil.which("piper"))

    dest_dir = piper_dir() / "bin"
    exe = dest_dir / "piper" / "piper.exe"
    if exe.exists():
        return exe

    log("  Downloading piper TTS engine (offline voice synthesizer)...")
    dest_dir.mkdir(parents=True, exist_ok=True)
    url = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
    zip_path = dest_dir / "piper_windows_amd64.zip"
    try:
        urllib.request.urlretrieve(url, zip_path)
        import zipfile
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest_dir)
        zip_path.unlink(missing_ok=True)
    except Exception as exc:
        log(f"  ! piper download failed: {exc}")
        return None

    if exe.exists():
        log(f"  piper ready at {exe}")
        return exe
    log("  ! piper download completed but piper.exe not found in archive")
    return None


def piper_dir() -> Path:
    if IS_WINDOWS:
        return Path(os.environ.get("APPDATA", str(Path.home()))) / "piper"
    return Path.home() / ".local" / "share" / "piper"


PIPER_VOICES = {
    "en": ("en/en_GB/alan/medium/en_GB-alan-medium.onnx", "en_GB-alan-medium.onnx"),
    "it": ("it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx", "it_IT-riccardo-x_low.onnx"),
    "ru": ("ru/ru_RU/ruslan/medium/ru_RU-ruslan-medium.onnx", "ru_RU-ruslan-medium.onnx"),
}


def download_piper_voice(lang: str) -> Path | None:
    if lang not in PIPER_VOICES:
        return None
    url_path, fname = PIPER_VOICES[lang]
    dest_dir = piper_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / fname
    base = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
    if dest.exists():
        log(f"  {fname} already downloaded")
        return dest
    for suffix, target in [("", dest), (".json", dest.with_suffix(dest.suffix + ".json"))]:
        url = f"{base}/{url_path}{suffix}"
        log(f"  Downloading {Path(target).name}...")
        try:
            urllib.request.urlretrieve(url, target)
        except Exception as exc:
            log(f"  ! download failed: {exc}")
            return None
    log(f"  {fname} ready")
    return dest


PROMPT_SRC = ROOT / "jarvis" / "system_prompt.txt"
PERSONAL_DIR = ROOT / "jarvis" / "personal info jarvis"
PERSONAL_PROMPT = PERSONAL_DIR / "system_prompt.txt"


def write_personal_prompt(cfg: dict) -> None:
    if not PROMPT_SRC.exists():
        return
    PERSONAL_DIR.mkdir(parents=True, exist_ok=True)
    text = PROMPT_SRC.read_text(encoding="utf-8")
    name = cfg.get("user_name") or "your operator"
    hw = cfg.get("user_hw") or "not specified"
    text = text.replace("[YOUR_NAME]", name)
    text = re.sub(r"- MACHINE: \[YOUR_HARDWARE[^\n]*", f"- MACHINE: {hw}", text)
    if IS_WINDOWS:
        distro, de, shell, pkg, audio = "Windows 11", "Windows Desktop", "PowerShell", "winget", "WASAPI"
    else:
        distro = platform.freedesktop_os_release().get("PRETTY_NAME", "Linux") \
            if hasattr(platform, "freedesktop_os_release") else "Linux"
        de = os.environ.get("XDG_CURRENT_DESKTOP", "unknown")
        shell = Path(os.environ.get("SHELL", "/bin/bash")).name
        pkg = detect_pkg_install()
        pkg = pkg[-2] if pkg else "unknown"
        audio = "PipeWire / PulseAudio"
    text = re.sub(r"\[YOUR_DISTRO[^\]]*\]", distro, text)
    text = re.sub(r"\[YOUR_DE_OR_WM[^\]]*\]", de, text)
    text = re.sub(r"\[YOUR_SHELL[^\]]*\]", shell, text)
    text = re.sub(r"\[YOUR_PKG_MGR[^\]]*\]", pkg, text)
    text = re.sub(r"\[YOUR_AUDIO[^\]]*\]", audio, text)
    PERSONAL_PROMPT.write_text(text, encoding="utf-8")
    log("Personal system prompt written.")


def save_config(cfg: dict) -> None:
    JARVIS_DIR.mkdir(parents=True, exist_ok=True)
    env = _read_env()

    backend = cfg.get("backend", "auto")
    if backend == "claude":
        if cfg.get("claude_token"):
            env["CLAUDE_CODE_OAUTH_TOKEN"] = cfg["claude_token"]
        env["JARVIS_LLM_BACKEND"] = "claude"
        env["JARVIS_CLAUDE_MODEL"] = cfg.get("claude_model", "claude-sonnet-4-6")
    elif backend == "openrouter":
        if cfg.get("openrouter_key"):
            env["OPENROUTER_API_KEY"] = cfg["openrouter_key"]
        env["JARVIS_LLM_BACKEND"] = "openrouter"
        if cfg.get("openrouter_model"):
            env["JARVIS_MODEL"] = cfg["openrouter_model"]
    elif backend == "ollama":
        env["JARVIS_LLM_BACKEND"] = "ollama"
        if cfg.get("ollama_model"):
            env["JARVIS_OLLAMA_MODEL"] = cfg["ollama_model"]
    else:
        env["JARVIS_LLM_BACKEND"] = "auto"
        if cfg.get("claude_token"):
            env["CLAUDE_CODE_OAUTH_TOKEN"] = cfg["claude_token"]
        if cfg.get("openrouter_key"):
            env["OPENROUTER_API_KEY"] = cfg["openrouter_key"]
        env["JARVIS_CLAUDE_MODEL"] = cfg.get("claude_model", "claude-sonnet-4-6")

    if cfg.get("whisper_model"):
        env["JARVIS_WHISPER_MODEL"] = cfg["whisper_model"]

    if cfg.get("disable_wakeword"):
        env["JARVIS_DISABLE_WAKEWORD"] = "1"
    else:
        env.pop("JARVIS_DISABLE_WAKEWORD", None)

    for lang in ("en", "it", "ru"):
        if cfg.get(f"piper_{lang}"):
            path = download_piper_voice(lang)
            if path:
                env[f"JARVIS_PIPER_MODEL_{lang.upper()}"] = str(path)

    if IS_WINDOWS and not shutil.which("piper"):
        exe = download_piper_binary_windows()
        if exe:
            env["JARVIS_PIPER_BIN"] = str(exe)
    elif not (shutil.which("piper") or shutil.which("piper-tts")):
        env.setdefault("JARVIS_PIPER_BIN", "piper")

    write_personal_prompt(cfg)

    lines = ["# JARVIS credentials — generated by bootstrap.py", ""]
    for k, v in env.items():
        lines.append(f"{k}={v}")
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if not IS_WINDOWS:
        try:
            os.chmod(ENV_FILE, 0o600)
        except OSError:
            pass
    log("Configuration saved to " + str(ENV_FILE))


# ──────────────────────────────────────────────────────────────────────────
# Launch the real app
# ──────────────────────────────────────────────────────────────────────────

_httpd: ThreadingHTTPServer | None = None


def launch_jarvis() -> None:
    _state["launching"] = True
    log("Starting JARVIS...")

    def _go() -> None:
        time.sleep(0.5)
        global _httpd
        if _httpd is not None:
            _httpd.shutdown()
            _httpd.server_close()
        env = {**os.environ}
        for k, v in _read_env().items():
            env.setdefault(k, v)
        cmd = [str(VENV_UVICORN), "jarvis.main:app", "--host", "127.0.0.1",
               "--port", str(PORT), "--workers", "1", "--timeout-keep-alive", "75"]
        if not IS_WINDOWS:
            cmd += ["--loop", "uvloop", "--http", "httptools"]
        kwargs: dict = {"cwd": str(ROOT), "env": env}
        if IS_WINDOWS:
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen(cmd, **kwargs)
        _state["launched"] = True

    threading.Thread(target=_go, daemon=True).start()


# ──────────────────────────────────────────────────────────────────────────
# HTTP server
# ──────────────────────────────────────────────────────────────────────────

WIZARD_HTML = (ROOT / "setup_wizard.html").read_text(encoding="utf-8")


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError)):
            return
        super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # noqa: A002 - silence default logging
        pass

    def _json(self, obj: dict, status: int = 200) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except Exception:
            return {}

    def do_GET(self) -> None:
        if self.path == "/" or self.path.startswith("/?"):
            body = WIZARD_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/state":
            env = _read_env()
            self._json({
                "os": "windows" if IS_WINDOWS else "linux",
                "venv_ready": venv_ready(),
                "configured": bool(env.get("CLAUDE_CODE_OAUTH_TOKEN") or env.get("OPENROUTER_API_KEY")
                                   or env.get("JARVIS_LLM_BACKEND") == "ollama"),
                "ollama_models": list_ollama_models(),
                "state": _state,
                "env": {k: ("***" if "TOKEN" in k or "KEY" in k else v) for k, v in env.items()},
            })
        elif self.path == "/api/hardware":
            self._json(detect_hardware())
        elif self.path == "/api/log_stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            idx = 0
            try:
                while True:
                    with _log_cv:
                        while idx >= len(_log_lines):
                            if not _log_cv.wait(timeout=30):
                                self.wfile.write(b": ping\n\n")
                                self.wfile.flush()
                                continue
                        pending = _log_lines[idx:]
                        idx = len(_log_lines)
                    for line in pending:
                        data = json.dumps(line)
                        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                    payload = json.dumps(_state)
                    self.wfile.write(f"event: state\ndata: {payload}\n\n".encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:
        if self.path == "/api/install":
            if not _state["installing"] and not _state["install_done"]:
                threading.Thread(target=run_install, daemon=True).start()
            self._json({"ok": True})
        elif self.path == "/api/save_config":
            cfg = self._body()
            try:
                save_config(cfg)
                self._json({"ok": True})
            except Exception as exc:
                self._json({"ok": False, "error": str(exc)}, status=500)
        elif self.path == "/api/verify":
            body = self._body()
            backend = body.get("backend")
            if backend == "claude":
                self._json(verify_claude_token(body.get("token", "")))
            elif backend == "openrouter":
                self._json(verify_openrouter_key(body.get("key", "")))
            else:
                self._json({"ok": False, "message": "Unknown backend"})
        elif self.path == "/api/launch":
            launch_jarvis()
            self._json({"ok": True})
        else:
            self.send_response(404)
            self.end_headers()


def _port_in_use(port: int) -> bool:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def main() -> None:
    global _httpd
    JARVIS_DIR.mkdir(parents=True, exist_ok=True)

    if _port_in_use(PORT):
        log(f"JARVIS is already running at http://127.0.0.1:{PORT} — opening browser.")
        try:
            import webbrowser
            webbrowser.open(f"http://127.0.0.1:{PORT}")
        except Exception:
            pass
        return

    if venv_ready() and _read_env():
        env = _read_env()
        if env.get("CLAUDE_CODE_OAUTH_TOKEN") or env.get("OPENROUTER_API_KEY") or env.get("JARVIS_LLM_BACKEND") == "ollama":
            log("Existing setup found — launching JARVIS directly.")
            _state["install_done"] = True
            _httpd = QuietThreadingHTTPServer(("127.0.0.1", PORT), Handler)
            launch_jarvis()
            t = threading.Thread(target=_httpd.serve_forever, daemon=True)
            t.start()
            try:
                import webbrowser
                threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
            except Exception:
                pass
            time.sleep(2)
            return

    _httpd = QuietThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log(f"Setup wizard: http://127.0.0.1:{PORT}")
    try:
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{PORT}")
    except Exception:
        pass
    _httpd.serve_forever()


if __name__ == "__main__":
    main()
