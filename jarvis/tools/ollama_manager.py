"""Ollama local-model manager — hardware detection, model catalog, pull streaming,
and backend switching for the JARVIS Settings page."""
from __future__ import annotations

import json
import platform
import re
import subprocess
from pathlib import Path
from typing import AsyncGenerator

OLLAMA_BASE = "http://localhost:11434"
JARVIS_DIR = Path.home() / ".jarvis"
ENV_PATH = JARVIS_DIR / ".env"


# ──────────────────────────────────────────────────────────────────────────
# Hardware detection
# ──────────────────────────────────────────────────────────────────────────


def detect_ram_gb() -> float:
    """Return total system RAM in GB."""
    try:
        import psutil  # type: ignore
        return psutil.virtual_memory().total / (1024 ** 3)
    except Exception:
        return 0.0


def detect_cpu() -> str:
    """Return a human-readable CPU name."""
    # On Windows, the registry has the proper brand string
    if platform.system() == "Windows":
        try:
            import winreg
            key = r"HARDWARE\DESCRIPTION\System\CentralProcessor\0"
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key) as k:
                name, _ = winreg.QueryValueEx(k, "ProcessorNameString")
                return name.strip()
        except Exception:
            pass
    # Linux/mac fallback
    name = platform.processor() or platform.machine()
    return name or "Unknown CPU"


def detect_gpu() -> dict:
    """Detect GPU name and VRAM (in GB).

    Windows: reads the 64-bit VRAM value from the GPU registry key
    (HardwareInformation.qwMemorySize), which correctly reports >4 GB unlike
    WMI's 32-bit AdapterRAM field.  Fallback: rocm-smi (AMD), then WMI.
    Returns {"name": str, "vram_gb": float}.
    """
    # ── Windows: registry (64-bit qwMemorySize) ───────────────────────────
    if platform.system() == "Windows":
        try:
            import winreg  # type: ignore  # stdlib on Windows
            GPU_CLASS_KEY = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
            best_name, best_vram = "Unknown", 0.0
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, GPU_CLASS_KEY) as cls_key:
                i = 0
                while True:
                    try:
                        sub = winreg.EnumKey(cls_key, i)
                        i += 1
                    except OSError:
                        break
                    try:
                        with winreg.OpenKey(cls_key, sub) as dev_key:
                            try:
                                name, _ = winreg.QueryValueEx(dev_key, "DriverDesc")
                            except FileNotFoundError:
                                continue
                            if not name or "Virtual" in name or "Basic" in name:
                                continue
                            # Prefer 64-bit qwMemorySize; fall back to 32-bit MemorySize
                            vram_bytes = 0
                            for field in ("HardwareInformation.qwMemorySize",
                                          "HardwareInformation.MemorySize"):
                                try:
                                    val, _ = winreg.QueryValueEx(dev_key, field)
                                    vram_bytes = int(val)
                                    if vram_bytes > 0:
                                        break
                                except FileNotFoundError:
                                    pass
                            vram_gb = vram_bytes / (1024 ** 3)
                            if vram_gb > best_vram:
                                best_vram = vram_gb
                                best_name = name
                    except OSError:
                        continue
            if best_name != "Unknown" or best_vram > 0:
                return {"name": best_name, "vram_gb": round(best_vram, 1)}
        except Exception:
            pass

    # ── AMD fallback: rocm-smi ─────────────────────────────────────────────
    try:
        result = subprocess.run(
            ["rocm-smi", "--showmeminfo", "vram", "--json"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            for card_data in data.values():
                total = card_data.get("VRAM Total Memory (B)", 0)
                if total:
                    vram_gb = int(total) / (1024 ** 3)
                    return {"name": "AMD GPU (rocm-smi)", "vram_gb": round(vram_gb, 1)}
    except Exception:
        pass

    # ── Last resort: wmic (32-bit, caps at ~4 GB for large GPUs) ─────────
    try:
        result = subprocess.run(
            ["wmic", "path", "Win32_VideoController", "get",
             "Name,AdapterRAM", "/format:csv"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            best_name, best_vram = "Unknown", 0.0
            for line in result.stdout.splitlines():
                line = line.strip()
                if not line or line.startswith("Node"):
                    continue
                parts = line.split(",")
                if len(parts) >= 3:
                    try:
                        vram_gb = int(parts[1].strip()) / (1024 ** 3)
                        gpu_name = parts[2].strip()
                    except (ValueError, IndexError):
                        continue
                    if vram_gb > best_vram:
                        best_vram, best_name = vram_gb, gpu_name
            if best_name != "Unknown" or best_vram > 0:
                return {"name": best_name, "vram_gb": round(best_vram, 1)}
    except Exception:
        pass

    return {"name": "Unknown", "vram_gb": 0.0}


# ──────────────────────────────────────────────────────────────────────────
# Ollama connectivity
# ──────────────────────────────────────────────────────────────────────────


async def ollama_running() -> bool:
    """Return True if Ollama is reachable at localhost:11434."""
    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{OLLAMA_BASE}/api/tags", timeout=aiohttp.ClientTimeout(total=3)) as resp:
                return resp.status == 200
    except Exception:
        return False


async def list_installed_models() -> list[str]:
    """Return list of model names currently pulled into Ollama."""
    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{OLLAMA_BASE}/api/tags", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()
                return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


# ──────────────────────────────────────────────────────────────────────────
# Curated model catalog
# ──────────────────────────────────────────────────────────────────────────

MODEL_CATALOG: list[dict] = [
    {"name": "qwen2.5:3b",      "params_b": 3,  "vram_q4_gb": 2.5,  "desc": "Tiny, fast, great for low VRAM"},
    {"name": "llama3.2:3b",     "params_b": 3,  "vram_q4_gb": 2.5,  "desc": "Meta's compact Llama 3.2"},
    {"name": "mistral:7b",      "params_b": 7,  "vram_q4_gb": 4.5,  "desc": "Mistral's fast 7B model"},
    {"name": "llama3.1:8b",     "params_b": 8,  "vram_q4_gb": 5.5,  "desc": "Meta Llama 3.1 8B — strong general purpose"},
    {"name": "qwen2.5:7b",      "params_b": 7,  "vram_q4_gb": 5.0,  "desc": "Alibaba Qwen 2.5 7B"},
    {"name": "gemma3:12b",      "params_b": 12, "vram_q4_gb": 8.5,  "desc": "Google Gemma 3 12B"},
    {"name": "qwen2.5:14b",     "params_b": 14, "vram_q4_gb": 9.5,  "desc": "Qwen 2.5 14B — excellent quality/size ratio"},
    {"name": "deepseek-r1:14b", "params_b": 14, "vram_q4_gb": 10.0, "desc": "DeepSeek-R1 14B reasoning model"},
    {"name": "llama3.3:70b",    "params_b": 70, "vram_q4_gb": 43.0, "desc": "Llama 3.3 70B — top open-source quality"},
    {"name": "qwen2.5:32b",     "params_b": 32, "vram_q4_gb": 20.0, "desc": "Qwen 2.5 32B — near-frontier quality"},
    {"name": "deepseek-r1:32b", "params_b": 32, "vram_q4_gb": 20.0, "desc": "DeepSeek-R1 32B reasoning"},
    {"name": "phi4:14b",        "params_b": 14, "vram_q4_gb": 9.5,  "desc": "Microsoft Phi-4 14B"},
]


# ──────────────────────────────────────────────────────────────────────────
# Recommendation logic
# ──────────────────────────────────────────────────────────────────────────


def get_recommendations(vram_gb: float, ram_gb: float) -> list[dict]:
    """Return MODEL_CATALOG annotated with fit flags and a single 'recommended' winner.

    Fit rules:
    - fits_vram: model fits fully in GPU VRAM (1.5 GB headroom).
    - fits_with_offload: model can run with CPU offload (uses spare RAM at 50%).
    The model with the highest params_b that fits_vram is marked recommended=True.
    Sort order: fits_vram desc params → offload-only desc params → too large desc params.
    """
    annotated = []
    for m in MODEL_CATALOG:
        req = m["vram_q4_gb"]
        fits_vram = req <= vram_gb - 1.5
        fits_offload = (not fits_vram) and (req <= vram_gb + ram_gb * 0.5 - 2)
        annotated.append({
            **m,
            "fits_vram": fits_vram,
            "fits_with_offload": fits_offload,
            "recommended": False,
        })

    # Pick the best pure-VRAM fit
    vram_fits = [m for m in annotated if m["fits_vram"]]
    if vram_fits:
        best = max(vram_fits, key=lambda m: m["params_b"])
        best["recommended"] = True

    def _sort_key(m: dict) -> tuple:
        if m["fits_vram"]:
            tier = 0
        elif m["fits_with_offload"]:
            tier = 1
        else:
            tier = 2
        return (tier, -m["params_b"])

    return sorted(annotated, key=_sort_key)


# ──────────────────────────────────────────────────────────────────────────
# Pull streaming
# ──────────────────────────────────────────────────────────────────────────


async def stream_pull(model_name: str) -> AsyncGenerator[str, None]:
    """Async generator that POSTs to /api/pull and yields NDJSON lines."""
    import aiohttp
    payload = {"name": model_name, "stream": True}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{OLLAMA_BASE}/api/pull",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=3600),
            ) as resp:
                async for raw_line in resp.content:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if line:
                        yield line
    except Exception as exc:
        yield json.dumps({"error": str(exc)})


# ──────────────────────────────────────────────────────────────────────────
# Backend switching
# ──────────────────────────────────────────────────────────────────────────


async def set_ollama_model(model_name: str) -> None:
    """Write JARVIS_LLM_BACKEND=ollama and JARVIS_OLLAMA_MODEL=<model> to ~/.jarvis/.env."""
    JARVIS_DIR.mkdir(parents=True, exist_ok=True)

    # Read existing lines (preserve other settings)
    lines: list[str] = []
    if ENV_PATH.exists():
        try:
            lines = ENV_PATH.read_text(encoding="utf-8").splitlines()
        except OSError:
            lines = []

    # Remove existing JARVIS_LLM_BACKEND and JARVIS_OLLAMA_MODEL lines
    lines = [
        ln for ln in lines
        if not re.match(r"^(export\s+)?(JARVIS_LLM_BACKEND|JARVIS_OLLAMA_MODEL)\s*=", ln)
    ]

    lines.append(f"JARVIS_LLM_BACKEND=ollama")
    lines.append(f"JARVIS_OLLAMA_MODEL={model_name}")

    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
