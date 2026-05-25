"""Speech-to-text wrapper around faster-whisper."""
from __future__ import annotations

import asyncio
import os
from typing import Any

try:
    from faster_whisper import WhisperModel
except ImportError:  # pragma: no cover
    WhisperModel = None  # type: ignore


DEFAULT_MODEL = os.environ.get("JARVIS_WHISPER_MODEL", "base.en")

# Auto-detect CUDA if available, fallback to CPU
_DETECTED_DEVICE = None
try:
    import torch
    if torch.cuda.is_available():
        _DETECTED_DEVICE = "cuda"
except Exception:
    pass

DEFAULT_DEVICE = os.environ.get("JARVIS_WHISPER_DEVICE", _DETECTED_DEVICE or "cpu")
DEFAULT_COMPUTE = os.environ.get("JARVIS_WHISPER_COMPUTE", "int8" if DEFAULT_DEVICE == "cpu" else "float16")


class STT:
    """Lazy-loaded whisper transcriber.

    Loads the model on first use to avoid blocking startup. Calls run in a
    worker thread so they don't block the asyncio loop.
    """

    def __init__(
        self,
        model_size: str = DEFAULT_MODEL,
        device: str = DEFAULT_DEVICE,
        compute_type: str = DEFAULT_COMPUTE,
    ) -> None:
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self._model: Any = None
        self._load_lock = asyncio.Lock()

    async def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        async with self._load_lock:
            if self._model is not None:
                return
            if WhisperModel is None:
                raise RuntimeError(
                    "faster-whisper is not installed. Run: pip install faster-whisper"
                )
            self._model = await asyncio.to_thread(
                WhisperModel, self.model_size, device=self.device, compute_type=self.compute_type
            )

    async def ensure_loaded(self) -> None:
        """Public pre-warm method — call at startup to avoid first-request latency."""
        await self._ensure_loaded()

    async def transcribe_file(
        self,
        path: str,
        language: str | None = None,
        vad_filter: bool = True,
    ) -> dict[str, Any]:
        """Transcribe an audio file (any format ffmpeg can decode)."""
        await self._ensure_loaded()

        def _run() -> dict[str, Any]:
            segments, info = self._model.transcribe(
                path,
                language=language,
                vad_filter=vad_filter,
                vad_parameters={"threshold": 0.3, "min_silence_duration_ms": 300, "speech_pad_ms": 400},
                beam_size=5,
            )
            text = "".join(seg.text for seg in segments).strip()
            return {
                "text": text,
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration,
            }

        return await asyncio.to_thread(_run)

    async def transcribe_pcm(
        self,
        pcm_bytes: bytes,
        sample_rate: int = 16_000,
        channels: int = 1,
        sample_width: int = 2,
        language: str | None = None,
        vad_filter: bool = False,
    ) -> dict[str, Any]:
        """Transcribe raw 16-bit PCM audio (typical mic capture).

        Passes a float32 numpy array directly to faster-whisper to avoid
        a round-trip through a temp .wav file on disk.
        vad_filter defaults to False for wake-word triggered captures since
        we already know speech is present and aggressive VAD silently drops it.
        """
        import numpy as np  # type: ignore

        await self._ensure_loaded()

        # Mono-mix multi-channel audio by averaging channels
        samples = np.frombuffer(pcm_bytes, dtype=np.int16)
        if channels > 1:
            samples = samples.reshape(-1, channels).mean(axis=1).astype(np.int16)
        audio = samples.astype(np.float32) / 32768.0

        def _run() -> dict[str, Any]:
            segments, info = self._model.transcribe(
                audio,
                language=language,
                vad_filter=vad_filter,
                vad_parameters={"threshold": 0.3, "min_silence_duration_ms": 300, "speech_pad_ms": 400},
                beam_size=5,
            )
            text = "".join(seg.text for seg in segments).strip()
            return {
                "text": text,
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration,
            }

        return await asyncio.to_thread(_run)


# Module-level singleton (lazy)
_stt_instance: STT | None = None


def get_stt() -> STT:
    global _stt_instance
    if _stt_instance is None:
        _stt_instance = STT()
    return _stt_instance
