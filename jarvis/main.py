"""JARVIS — FastAPI backend + WebSocket bridge + wake-word loop.

Run:
    uvicorn jarvis.main:app --host 127.0.0.1 --port 8765

Credentials are loaded from ~/.jarvis/.env on startup (CLAUDE_CODE_OAUTH_TOKEN
for Claude Pro, optionally OPENROUTER_API_KEY for fallback).

The wake-word loop is started in the background on app startup if openwakeword
and a microphone are available; on failure it logs and the UI still works for
text input.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import signal
import time
from pathlib import Path
from typing import Any


def _load_dotenv() -> None:
    """Load ~/.jarvis/.env into os.environ (without overriding existing vars).

    Implemented inline so we don't require python-dotenv. Supports simple
    KEY=VALUE lines with optional quoting and `#` comments.
    """
    paths = [Path.home() / ".jarvis" / ".env", Path(".env")]
    for path in paths:
        if not path.exists():
            continue
        try:
            for raw in path.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[len("export "):].lstrip()
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip()
                if (val.startswith('"') and val.endswith('"')) or \
                   (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                if key and key not in os.environ:
                    os.environ[key] = val
        except OSError:
            continue


# Load env files BEFORE importing modules that read env at import time.
_load_dotenv()


from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from . import llm, tts
from .stt import get_stt
from .task_manager import TaskManager
from .tools import hypr as hypr_tool

logging.basicConfig(
    level=os.environ.get("JARVIS_LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("jarvis")

ROOT = Path(__file__).parent
STATIC_DIR = ROOT / "static"
# Personal prompt (gitignored) takes priority; fall back to the committed template.
_PERSONAL_PROMPT = ROOT / "personal info jarvis" / "system_prompt.txt"
SYSTEM_PROMPT_PATH = _PERSONAL_PROMPT if _PERSONAL_PROMPT.exists() else ROOT / "system_prompt.txt"
HISTORY_PATH = Path.home() / ".jarvis" / "history.json"
_MAX_HISTORY = 40  # user/assistant messages to persist across reboots

app = FastAPI(title="JARVIS", version="1.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Enable gzip compression for responses (especially WebSocket messages)
app.add_middleware(GZipMiddleware, minimum_size=1024)

_ONLINE_CHECK_RE = re.compile(
    r"are\s+you\s+(?:online|there|alive|running|up|active|ready)"
    r"|you\s+online"
    r"|status\s+check",
    re.IGNORECASE,
)
WEBUI_URL = "http://127.0.0.1:8765"


# ──────────────────────────────────────────────────────────────────────────
# Shared state
# ──────────────────────────────────────────────────────────────────────────


class Hub:
    """Tracks connected WebSocket clients so the wake-word loop can push to them."""

    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def broadcast(self, msg: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in list(self.clients):
            try:
                await ws.send_text(json.dumps(msg, ensure_ascii=False))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def add(self, ws: WebSocket) -> None:
        self.clients.add(ws)

    def remove(self, ws: WebSocket) -> None:
        self.clients.discard(ws)


hub = Hub()
conversation: list[dict[str, Any]] = []
_lock = asyncio.Lock()
_tasks: set[asyncio.Task] = set()

# ── Language tracking ──────────────────────────────────────────────────────
# Updated by STT on each voice input; used for TTS language selection.
_current_lang: str = "en"


def _detect_text_language(text: str) -> str:
    """Heuristic language detection from text characters and common words."""
    # Cyrillic → Russian
    if any('Ѐ' <= c <= 'ӿ' for c in text):
        return "ru"
    # Italian diacritics
    if any(c in 'àèéìíîòóùúâêôûãõ' for c in text.lower()):
        return "it"
    # Common Italian words (covers responses without diacritics)
    _IT_WORDS = frozenset({
        "signore", "ciao", "grazie", "prego", "bene", "come", "stai",
        "sono", "hai", "che", "del", "della", "degli", "delle",
        "questo", "questa", "questi", "queste", "anche", "molto",
        "tutto", "tutti", "tutte", "quando", "dove", "ancora", "sempre",
        "subito", "capito", "perfetto", "confermato", "operativo",
        "completato", "avviato", "pronto", "fatto", "disponibile",
        "ricevo", "perfettamente", "attivo", "sistema", "canale",
    })
    words = set(text.lower().split())
    it_hits = len(words & _IT_WORDS)
    if it_hits >= 2 or (it_hits >= 1 and len(words) <= 8):
        return "it"
    return "en"


def _extract_first_sentence(buf: str) -> tuple[str | None, str]:
    """Extract one complete sentence from *buf*.
    Returns (sentence, remainder) or (None, buf) if none found yet."""
    for sep in ('. ', '! ', '? ', '.\n', '!\n', '?\n'):
        i = buf.find(sep)
        if i >= 0:
            return buf[:i + 1].strip(), buf[i + len(sep):]
    return None, buf


def _create_task(coro) -> asyncio.Task:
    """Create a task and keep a strong reference so GC can't cancel it."""
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


def _load_system_prompt() -> str:
    if SYSTEM_PROMPT_PATH.exists():
        return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
    log.warning("system_prompt.txt not found, using fallback")
    return "You are JARVIS, a helpful Arch Linux system assistant."


def _save_history() -> None:
    msgs = [m for m in conversation if m.get("role") in ("user", "assistant")]
    to_save = msgs[-_MAX_HISTORY:]
    try:
        HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        HISTORY_PATH.write_text(
            json.dumps(to_save, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception as exc:
        log.warning("history save failed: %s", exc)


def _load_history() -> list[dict]:
    if not HISTORY_PATH.exists():
        return []
    try:
        data = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        return [m for m in data if isinstance(m, dict) and m.get("role") in ("user", "assistant")]
    except Exception as exc:
        log.warning("history load failed: %s", exc)
        return []


def _reset_conversation() -> None:
    conversation.clear()
    conversation.append({"role": "system", "content": _load_system_prompt()})


_reset_conversation()


# ── Batch history saving (debounced) ───────────────────────────────────────
# Instead of writing history to disk after every turn, batch writes with a 5s delay.
# If another turn starts before the timer fires, cancel and restart the timer.
_history_save_task: asyncio.Task | None = None
_history_save_lock = asyncio.Lock()
_current_turn_task: asyncio.Task | None = None

async def _debounced_save_history() -> None:
    """Save history to disk, but only if no write has happened in 5 seconds."""
    global _history_save_task
    
    async with _history_save_lock:
        # Cancel any pending save
        if _history_save_task is not None:
            _history_save_task.cancel()
            try:
                await _history_save_task
            except asyncio.CancelledError:
                pass
        
        # Schedule a new save 5 seconds from now
        async def _save_later() -> None:
            await asyncio.sleep(5)
            _save_history()
        
        _history_save_task = _create_task(_save_later())


# ──────────────────────────────────────────────────────────────────────────
# Core: handle one user turn
# ──────────────────────────────────────────────────────────────────────────


async def handle_user_turn(text: str, *, voice: bool, send: Any) -> None:
    """Run a full LLM + tool turn, streaming events to `send` (a callable
    awaiting a dict) and broadcasting to all other clients."""
    global _current_lang, _current_turn_task
    _current_turn_task = asyncio.current_task()

    if not text.strip():
        return

    # Stop any ongoing speech from the previous turn immediately
    await tts.cancel_speaking()

    # Determine language — for voice input, _current_lang was already updated by the
    # STT caller; for typed input we do a quick heuristic scan.
    detected_lang = _current_lang if voice else _detect_text_language(text)

    # Fast-path: "are you online" — skip LLM, speak greeting, open WebUI
    if _ONLINE_CHECK_RE.search(text):
        reply = "Online and ready, sir. All systems nominal."
        await _emit({"type": "transcript", "text": text, "voice": voice}, send)
        await _emit({"type": "turn_start", "voice": voice}, send)
        await _emit({"type": "turn_end", "final_text": reply, "elapsed": 0.0}, send)
        await _emit({"type": "speaking", "state": "start"}, send)
        await tts.speak(reply, lang=detected_lang)
        await _emit({"type": "speaking", "state": "end"}, send)
        await hypr_tool.dispatch("exec", f"firefox {WEBUI_URL}")
        return

    user_message = f"[VOICE] {text}" if voice else text
    await _emit({"type": "transcript", "text": text, "voice": voice}, send)

    async with _lock:
        conversation.append({"role": "user", "content": user_message})
        msgs_snapshot = list(conversation)

    task_mgr = TaskManager()

    # ── Sentence-streaming TTS state ──────────────────────────────────────
    # As response_delta events arrive, we buffer text and speak each complete
    # sentence immediately — so speech starts during generation, not after.
    _tts_buf = ""
    _sentence_tasks: list[asyncio.Task] = []
    _speaking_started = False

    async def on_event(event: dict[str, Any]) -> None:
        nonlocal _tts_buf, _speaking_started
        # Forward raw event to UI
        await _emit({"type": "llm_event", "event": event}, send)
        # Let task manager react
        snap = task_mgr.handle_event(event)
        if snap is not None:
            await _emit({"type": "task_update", **snap}, send)
            if snap.get("kind") == "task_plan":
                goal = snap.get("plan", {}).get("goal", "")
                phrase = f"Understood. Initiating task: {goal}" if goal else "Understood. Task initiated."
                await _emit({"type": "speaking", "state": "start"}, send)
                await tts.speak(phrase, lang=detected_lang)
                await _emit({"type": "speaking", "state": "end"}, send)
            elif snap.get("kind") == "step":
                plan = snap.get("plan", {})
                step = plan.get("changed_step", {})
                status = step.get("status", "")
                total = plan.get("total_steps", 0)
                if status == "running" and total >= 3:
                    n = step.get("n", "?")
                    label = step.get("label", "")
                    phrase = f"Step {n}: {label}." if label else f"Running step {n}."
                    await _emit({"type": "speaking", "state": "start"}, send)
                    await tts.speak(phrase, lang=detected_lang)
                    await _emit({"type": "speaking", "state": "end"}, send)
                elif status == "error":
                    n = step.get("n", "?")
                    reason = step.get("reason", "")
                    phrase = f"Step {n} failed. {reason}" if reason else f"Step {n} failed."
                    await _emit({"type": "speaking", "state": "start"}, send)
                    await tts.speak(phrase, lang=detected_lang)
                    await _emit({"type": "speaking", "state": "end"}, send)

        # Sentence-streaming: queue each complete sentence for TTS as it arrives
        if event.get("type") == "response_delta":
            _tts_buf += event.get("text", "")
            while True:
                sentence, rest = _extract_first_sentence(_tts_buf)
                if sentence is None:
                    break
                _tts_buf = rest
                clean = tts.strip_for_tts(sentence).strip()
                # Only speak if meaningful length (avoids single-char artefacts)
                if clean and len(clean) >= 12:
                    if not _speaking_started:
                        _speaking_started = True
                        await _emit({"type": "speaking", "state": "start"}, send)
                    t = _create_task(tts.speak(clean, lang=detected_lang))
                    _sentence_tasks.append(t)

    started = time.time()
    await _emit({"type": "turn_start", "voice": voice}, send)
    try:
        result = await llm.stream_chat(msgs_snapshot, on_event)
    except Exception as exc:
        log.exception("LLM stream failed")
        await _emit({"type": "error", "message": f"LLM stream failed: {exc}"}, send)
        return

    async with _lock:
        # Replace conversation with the (longer) one returned from the LLM loop
        if len(result.get("messages", [])) >= len(conversation):
            conversation[:] = result["messages"]
    _create_task(_debounced_save_history())

    final_text = (result.get("final_text") or "").strip()
    elapsed = round(time.time() - started, 2)
    await _emit({
        "type": "turn_end",
        "final_text": final_text,
        "elapsed": elapsed,
    }, send)

    # Speak any remaining buffer fragment not yet queued
    remainder = tts.strip_for_tts(_tts_buf).strip()
    if remainder and len(remainder) >= 4:
        if not _speaking_started:
            _speaking_started = True
            await _emit({"type": "speaking", "state": "start"}, send)
        t = _create_task(tts.speak(remainder, lang=detected_lang))
        _sentence_tasks.append(t)

    if _sentence_tasks:
        # Wait for all sentence TTS tasks to finish, then signal end
        await asyncio.gather(*_sentence_tasks, return_exceptions=True)
        await _emit({"type": "speaking", "state": "end"}, send)
    elif final_text:
        # Fallback: nothing was streamed sentence-by-sentence (very short response)
        await _emit({"type": "speaking", "state": "start"}, send)
        speak_result = await tts.speak(final_text, lang=detected_lang)
        await _emit({"type": "speaking", "state": "end", "result": speak_result}, send)


async def _emit(msg: dict[str, Any], send: Any) -> None:
    """Broadcast a message to all connected clients.

    The originating WebSocket is already in ``hub.clients``, so a single
    broadcast covers it — sending directly via ``send`` would double-deliver.
    The ``send`` parameter is kept for API compatibility with callers (e.g.
    the wake-word loop) that don't have a WS connection of their own.
    """
    await hub.broadcast(msg)


# ──────────────────────────────────────────────────────────────────────────
# HTTP routes
# ──────────────────────────────────────────────────────────────────────────


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    has_claude = bool(os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"))
    has_or = bool(os.environ.get("OPENROUTER_API_KEY"))
    has_anth = bool(os.environ.get("ANTHROPIC_API_KEY"))
    return {
        "ok": True,
        "backend": llm._pick_backend(),
        "claude_model": llm.DEFAULT_CLAUDE_MODEL,
        "openrouter_model": llm.DEFAULT_OR_MODEL,
        "credentials": {
            "claude_oauth": has_claude,
            "openrouter": has_or,
            "anthropic_api_key_shadowing": has_claude and has_anth,
        },
        "clients": len(hub.clients),
        "conversation_length": len(conversation),
    }


@app.post("/api/speak")
async def speak_endpoint(body: dict[str, Any]) -> dict[str, Any]:
    """Fire-and-forget TTS endpoint for external scripts (e.g. Rofi launcher)."""
    text = str(body.get("text", "")).strip()
    lang = str(body.get("lang", "en"))
    if not text:
        return {"ok": False, "error": "text is required"}

    async def _run() -> None:
        await hub.broadcast({"type": "speaking", "state": "start"})
        await tts.speak(text, lang=lang)
        await hub.broadcast({"type": "speaking", "state": "end"})

    _create_task(_run())
    return {"ok": True, "text": text}


@app.post("/reset")
async def reset() -> dict[str, Any]:
    async with _lock:
        _reset_conversation()
    await llm.reset_session()
    await tts.cancel_speaking()
    try:
        HISTORY_PATH.unlink(missing_ok=True)
    except Exception:
        pass
    await hub.broadcast({"type": "reset"})
    return {"ok": True}


@app.get("/api/models")
async def api_models() -> dict[str, Any]:
    backend = llm._pick_backend()
    return {
        "ok": True,
        "backend": backend,
        "active": llm.get_active_model(),
        "models": llm.AVAILABLE_CLAUDE_MODELS,
    }


@app.post("/api/model")
async def api_set_model(body: dict[str, Any]) -> dict[str, Any]:
    model_id = str(body.get("model", "")).strip()
    ok = await llm.set_claude_model(model_id)
    if not ok:
        return {"ok": False, "error": f"unknown model: {model_id}"}
    await hub.broadcast({"type": "model_changed", "model": model_id, "backend": "claude"})
    return {"ok": True, "model": model_id}


@app.post("/api/shutdown")
async def api_shutdown() -> dict[str, Any]:
    """Gracefully shut down the entire JARVIS process."""
    global _current_turn_task
    if _current_turn_task and not _current_turn_task.done():
        _current_turn_task.cancel()
    await tts.cancel_speaking()
    _save_history()
    await hub.broadcast({"type": "shutdown"})

    async def _do_shutdown() -> None:
        await asyncio.sleep(0.4)
        os.kill(os.getpid(), signal.SIGTERM)

    _create_task(_do_shutdown())
    return {"ok": True}


@app.post("/api/stop")
async def api_stop() -> dict[str, Any]:
    global _current_turn_task
    cancelled = False
    if _current_turn_task and not _current_turn_task.done():
        _current_turn_task.cancel()
        cancelled = True
    await tts.cancel_speaking()
    await hub.broadcast({"type": "stopped"})
    return {"ok": True, "cancelled": cancelled}


# ──────────────────────────────────────────────────────────────────────────
# WebSocket
# ──────────────────────────────────────────────────────────────────────────


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    hub.add(ws)
    backend = llm._pick_backend()
    active_model = llm.get_active_model() if backend == "claude" else llm.DEFAULT_OR_MODEL
    await ws.send_text(json.dumps({"type": "ready", "model": active_model, "backend": backend}))
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_text(json.dumps({"type": "error", "message": "invalid JSON"}))
                continue
            mtype = msg.get("type")
            if mtype == "user_text":
                text = msg.get("text", "")
                voice = bool(msg.get("voice"))
                _create_task(handle_user_turn(text, voice=voice, send=ws.send_text))
            elif mtype == "user_audio_pcm":
                import base64
                b64 = msg.get("data", "")
                try:
                    pcm = base64.b64decode(b64)
                    stt_result = await get_stt().transcribe_pcm(pcm)
                    text = stt_result.get("text", "").strip()
                    if text:
                        detected = stt_result.get("language", "en") or "en"
                        global _current_lang
                        _current_lang = detected
                        await hub.broadcast({"type": "stt_language", "lang": detected,
                                             "prob": stt_result.get("language_probability", 1.0)})
                        _create_task(handle_user_turn(text, voice=True, send=ws.send_text))
                except Exception as exc:
                    await ws.send_text(json.dumps({"type": "error", "message": f"STT failed: {exc}"}))
            elif mtype == "reset":
                async with _lock:
                    _reset_conversation()
                await llm.reset_session()
                await hub.broadcast({"type": "reset"})
            elif mtype == "stop":
                global _current_turn_task
                if _current_turn_task and not _current_turn_task.done():
                    _current_turn_task.cancel()
                await tts.cancel_speaking()
                await hub.broadcast({"type": "stopped"})
            elif mtype == "ping":
                await ws.send_text(json.dumps({"type": "pong", "t": time.time()}))
            else:
                await ws.send_text(json.dumps({"type": "error", "message": f"unknown type: {mtype}"}))
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.exception("websocket error")
        try:
            await ws.send_text(json.dumps({"type": "error", "message": str(exc)}))
        except Exception:
            pass
    finally:
        hub.remove(ws)


# ──────────────────────────────────────────────────────────────────────────
# Wake-word loop (openwakeword + sounddevice) — fully optional
# ──────────────────────────────────────────────────────────────────────────


async def wake_word_loop() -> None:
    """Listen for 'Hey Jarvis' offline via openwakeword, then capture + STT + chat.

    All heavy lifting runs on threads so we don't block the event loop.
    If any dependency is missing, this coroutine exits quietly.
    """
    if os.environ.get("JARVIS_DISABLE_WAKEWORD") == "1":
        log.info("wake-word loop disabled via env")
        return
    try:
        import numpy as np  # type: ignore
        import sounddevice as sd  # type: ignore
        from openwakeword.model import Model as WakeModel  # type: ignore
    except ImportError as exc:
        log.warning("wake-word disabled: missing dependency (%s)", exc)
        return

    wake_phrase = os.environ.get("JARVIS_WAKE_MODEL", "hey_jarvis")
    sample_rate = 16_000
    chunk = 1280  # 80ms @ 16kHz, openwakeword's expected frame size
    loop = asyncio.get_running_loop()

    try:
        wake_model = await asyncio.to_thread(WakeModel, wakeword_models=[wake_phrase])
    except Exception as exc:
        log.warning("wake-word model load failed (%s) — disabling", exc)
        return

    audio_q: asyncio.Queue[bytes] = asyncio.Queue(maxsize=64)

    def _audio_cb(indata, frames, time_info, status) -> None:  # pragma: no cover
        try:
            loop.call_soon_threadsafe(audio_q.put_nowait, bytes(indata))
        except asyncio.QueueFull:
            pass

    log.info("wake-word loop listening for '%s'", wake_phrase)
    try:
        stream = sd.RawInputStream(
            samplerate=sample_rate, blocksize=chunk,
            dtype="int16", channels=1, callback=_audio_cb,
        )
    except Exception as exc:
        log.warning("microphone unavailable (%s) — wake-word disabled", exc)
        return

    silence_threshold = int(os.environ.get("JARVIS_WAKE_THRESHOLD", "500"))  # /1000 * model score
    capture_seconds = float(os.environ.get("JARVIS_CAPTURE_SECONDS", "8"))

    with stream:
        while True:
            try:
                pcm = await audio_q.get()
            except asyncio.CancelledError:
                return
            try:
                audio = np.frombuffer(pcm, dtype=np.int16)
                scores = await asyncio.to_thread(wake_model.predict, audio)
                score = max(scores.values()) if isinstance(scores, dict) else 0.0
            except Exception as exc:
                log.debug("wake predict error: %s", exc)
                continue
            if score >= (silence_threshold / 1000.0):
                log.info("wake word detected (score=%.2f)", score)
                await hub.broadcast({"type": "wake", "score": float(score)})
                # Preserve any already-buffered audio — the command may have been
                # spoken immediately after the wake phrase (e.g. "hey jarvis are you online").
                # Draining would silently discard it.
                captured: list[bytes] = []
                while not audio_q.empty():
                    try:
                        captured.append(audio_q.get_nowait())
                    except asyncio.QueueEmpty:
                        break
                frames_needed = int(sample_rate * capture_seconds / chunk) - len(captured)
                for _ in range(max(0, frames_needed)):
                    try:
                        captured.append(await asyncio.wait_for(audio_q.get(), timeout=1.0))
                    except asyncio.TimeoutError:
                        break
                pcm_blob = b"".join(captured)
                try:
                    # vad_filter=False: we know speech is present after a wake word;
                    # aggressive VAD would otherwise silently drop short utterances.
                    stt_result = await get_stt().transcribe_pcm(pcm_blob, vad_filter=False)
                    text = (stt_result.get("text") or "").strip()
                    # Update global language from wake-word STT detection
                    detected = stt_result.get("language", "en") or "en"
                    _current_lang = detected
                    await hub.broadcast({"type": "stt_language", "lang": detected,
                                         "prob": stt_result.get("language_probability", 1.0)})
                except Exception as exc:
                    log.exception("STT after wake failed: %s", exc)
                    text = ""
                if text:
                    log.info("wake-word STT: %r (lang=%s)", text, _current_lang)
                    _create_task(handle_user_turn(text, voice=True, send=hub.broadcast))
                # cooldown
                await asyncio.sleep(1.0)


@app.on_event("startup")
async def on_startup() -> None:
    backend = llm._pick_backend()
    if backend == "claude":
        log.info("JARVIS online — backend=claude (Pro), model=%s", llm.DEFAULT_CLAUDE_MODEL)
    elif backend == "openrouter":
        log.info("JARVIS online — backend=openrouter, model=%s", llm.DEFAULT_OR_MODEL)
    else:
        log.warning("JARVIS online but NO LLM CREDENTIALS — set CLAUDE_CODE_OAUTH_TOKEN or OPENROUTER_API_KEY in ~/.jarvis/.env")
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") and os.environ.get("ANTHROPIC_API_KEY"):
        log.warning("ANTHROPIC_API_KEY is set and will shadow your OAuth token — usage will hit API budget, not your Pro plan. unset it.")
    # Restore previous session history
    prev = _load_history()
    if prev:
        async with _lock:
            conversation.extend(prev)
        log.info("restored %d messages from previous session", len(prev))

    # Pre-warm the STT and TTS models so first requests don't stall
    async def _prewarm_stt() -> None:
        try:
            await get_stt().ensure_loaded()
            log.info("STT model ready")
        except Exception as exc:
            log.warning("STT pre-warm failed: %s", exc)
        
        try:
            await tts.ensure_piper_loaded()
            log.info("Piper TTS model ready")
        except Exception as exc:
            log.warning("Piper pre-warm failed: %s", exc)

    _create_task(_prewarm_stt())
    _create_task(wake_word_loop())
