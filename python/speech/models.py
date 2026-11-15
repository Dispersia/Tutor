"""
Model registry + lifecycle manager for the speech gateway.

Design goals (docs/DESIGN.md §5, §8):
  * lazy load models on first use
  * keep only ONE TTS checkpoint resident at a time (preset XOR design)
  * unload everything + clear the MLX cache when idle, so the Mac gets its RAM back
"""

from __future__ import annotations

import gc
import logging
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("speech.models")

# --- pinned checkpoints (override with env vars) -----------------------------

ASR_MODEL = os.environ.get("TUTOR_ASR", "mlx-community/Qwen3-ASR-1.7B-8bit")
ASR_LITE_MODEL = os.environ.get("TUTOR_ASR_LITE", "mlx-community/Qwen3-ASR-0.6B-8bit")
ALIGN_MODEL = os.environ.get("TUTOR_ALIGN", "mlx-community/Qwen3-ForcedAligner-0.6B-8bit")
TTS_PRESET_MODEL = os.environ.get(
    "TUTOR_TTS_PRESET", "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"
)
TTS_DESIGN_MODEL = os.environ.get(
    "TUTOR_TTS_DESIGN", "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16"
)
VAD_MODEL = os.environ.get("TUTOR_VAD", "mlx-community/silero-vad")

# Roles that map to a fixed checkpoint.
SINGLE = {"asr": ASR_MODEL, "asr_lite": ASR_LITE_MODEL, "align": ALIGN_MODEL, "vad": VAD_MODEL}
# TTS checkpoints are mutually exclusive — only one resident at a time.
TTS = {"tts_preset": TTS_PRESET_MODEL, "tts_design": TTS_DESIGN_MODEL}

# Default CustomVoice speaker per Qwen language name (mirrors the web presets).
# The client normally sends a voice; this is the safety net so a caller that
# omits it still gets audio instead of a 500 (Qwen3-TTS rejects `speaker=None`).
DEFAULT_SPEAKER_BY_LANG = {
    "Chinese": "Serena",
    "Cantonese": "Serena",
    "English": "Ryan",
    "Japanese": "Ono_Anna",
    "Korean": "Sohee",
}

# Style anchor for the CustomVoice presets. Qwen3-TTS samples emotion and
# prosody freely at its 0.9 default temperature, so the same speaker drifts
# between a murmur, a shout and sing-song from one clip to the next. Pinning a
# calm teacher register keeps every clip in the same lane.
DEFAULT_INSTRUCT = os.environ.get(
    "TUTOR_TTS_INSTRUCT",
    "Speak like a calm, professional language teacher: clear and precise "
    "articulation, warm and friendly, steady measured pace, natural intonation. "
    "Do not whisper, shout, laugh or sing.",
)
# VoiceDesign takes a voice *description* rather than a style cue.
DEFAULT_DESIGN_INSTRUCT = os.environ.get(
    "TUTOR_TTS_DESIGN_INSTRUCT",
    "A calm, professional language teacher: clear articulation, warm and "
    "friendly, steady measured pace, medium pitch, natural intonation.",
)
# Lower than the checkpoint's 0.9: same voice, much less prosody drift.
TTS_TEMPERATURE = float(os.environ.get("TUTOR_TTS_TEMPERATURE", "0.7"))


def model_id(kind: str) -> str:
    if kind in SINGLE:
        return SINGLE[kind]
    if kind in TTS:
        return TTS[kind]
    raise KeyError(kind)


def _load_model(kind: str, repo: str) -> Any:
    log.info("loading %s (%s)", kind, repo)
    t0 = time.time()
    if kind in ("asr", "asr_lite", "align", "vad"):
        from mlx_audio.stt import load  # type: ignore

        model = load(repo)
    else:
        from mlx_audio.tts.utils import load_model  # type: ignore

        model = load_model(repo)
    log.info("loaded %s in %.1fs", kind, time.time() - t0)
    return model


def _rss_bytes() -> int:
    """Resident set size of this process, in bytes."""
    try:
        out = subprocess.check_output(["ps", "-o", "rss=", "-p", str(os.getpid())], text=True)
        return int(out.strip()) * 1024
    except Exception:
        return 0


def mlx_memory() -> dict[str, int | None]:
    """MLX (Metal/unified) memory in bytes — this is what actually matters on a Mac."""
    try:
        import mlx.core as mx  # type: ignore

        def get(name: str) -> int | None:
            fn = getattr(mx, name, None)
            return int(fn()) if callable(fn) else None

        return {
            "active": get("get_active_memory"),
            "peak": get("get_peak_memory"),
            "cache": get("get_cache_memory"),
        }
    except Exception:
        return {"active": None, "peak": None, "cache": None}


def clear_mlx_cache() -> None:
    try:
        import mlx.core as mx  # type: ignore

        if hasattr(mx, "clear_cache"):
            mx.clear_cache()
        elif hasattr(mx, "metal") and hasattr(mx.metal, "clear_cache"):
            mx.metal.clear_cache()
    except Exception as exc:  # pragma: no cover - best effort
        log.debug("clear_cache failed: %s", exc)


@dataclass
class Manager:
    idle_timeout_s: float = float(os.environ.get("TUTOR_SPEECH_IDLE_TIMEOUT", "600"))
    exit_on_idle: bool = os.environ.get("TUTOR_SPEECH_EXIT_ON_IDLE", "true").lower() == "true"
    reaper_interval_s: float = 15.0

    _models: dict[str, Any] = field(default_factory=dict)
    _lock: threading.RLock = field(default_factory=threading.RLock)
    _infer: threading.Lock = field(default_factory=threading.Lock)
    _active: int = 0
    _last_activity: float = field(default_factory=time.time)
    _watchdog: threading.Thread | None = None
    _stop: threading.Event = field(default_factory=threading.Event)

    # --- activity tracking ------------------------------------------------
    def touch(self) -> None:
        self._last_activity = time.time()

    @property
    def last_activity(self) -> float:
        return self._last_activity

    def _enter(self) -> None:
        with self._lock:
            self._active += 1
            self.touch()

    def _exit(self) -> None:
        with self._lock:
            self._active = max(0, self._active - 1)
            self.touch()

    def inference(self) -> "_InferenceGuard":
        return _InferenceGuard(self)

    # --- model access -----------------------------------------------------
    def get(self, kind: str) -> Any:
        with self._lock:
            self.touch()
            if kind in self._models:
                return self._models[kind]
            # only one TTS checkpoint resident at a time
            if kind in TTS:
                for other in TTS:
                    if other != kind and other in self._models:
                        log.info("evicting %s to make room for %s", other, kind)
                        self._models.pop(other, None)
                        clear_mlx_cache()
                        gc.collect()
            self._models[kind] = _load_model(kind, model_id(kind))
            return self._models[kind]

    def resident(self) -> list[str]:
        with self._lock:
            return sorted(self._models)

    # --- unloading --------------------------------------------------------
    def unload_all(self) -> dict[str, Any]:
        with self._lock:
            before = _rss_bytes()
            mlx_before = mlx_memory()
            self._models.clear()
            gc.collect()
            clear_mlx_cache()
            gc.collect()
            after = _rss_bytes()
            mlx_after = mlx_memory()
            log.info(
                "unloaded models: rss %.0fMB -> %.0fMB, mlx active %s -> %s",
                before / 1e6,
                after / 1e6,
                mlx_before.get("active"),
                mlx_after.get("active"),
            )
            return {
                "rssBefore": before,
                "rssAfter": after,
                "mlxBefore": mlx_before,
                "mlxAfter": mlx_after,
                "models": [],
            }

    # --- idle watchdog ----------------------------------------------------
    def start_watchdog(self) -> None:
        if self._watchdog and self._watchdog.is_alive():
            return
        self._watchdog = threading.Thread(target=self._watch_loop, name="idle-reaper", daemon=True)
        self._watchdog.start()
        log.info("idle watchdog started (timeout=%.0fs, exit_on_idle=%s)", self.idle_timeout_s, self.exit_on_idle)

    def stop_watchdog(self) -> None:
        self._stop.set()

    def _watch_loop(self) -> None:
        while not self._stop.is_set():
            self._stop.wait(self.reaper_interval_s)
            with self._lock:
                idle = time.time() - self._last_activity
                busy = self._active > 0
                has_models = bool(self._models)
            if busy or not has_models:
                continue
            if idle >= self.idle_timeout_s:
                log.info("idle %.0fs >= %.0fs — releasing models", idle, self.idle_timeout_s)
                self.unload_all()
                if self.exit_on_idle:
                    log.info("exit_on_idle set — shutting the gateway down")
                    os._exit(0)


class _InferenceGuard:
    def __init__(self, mgr: Manager) -> None:
        self._mgr = mgr

    def __enter__(self) -> None:
        self._mgr._enter()
        self._mgr._infer.acquire()

    def __exit__(self, *exc: object) -> None:
        self._mgr._infer.release()
        self._mgr._exit()


# --- thin adapters around the mlx-audio APIs (defensive: versions differ) ----


def asr_transcribe(model: Any, audio_path: str, language: str | None = None, hint: str | None = None):
    kwargs: dict[str, Any] = {}
    if language:
        kwargs["language"] = language
    if hint:
        # `hint` is a comma-separated vocabulary/context → Qwen3-ASR hotwords
        words = [w.strip() for w in hint.split(",") if w.strip()]
        if words:
            kwargs["hotwords"] = words
    result = model.generate(audio_path, **kwargs)

    text = getattr(result, "text", None)
    if text is None and isinstance(result, dict):
        text = result.get("text", "")
    segments = getattr(result, "segments", []) or []
    return {"text": text or "", "segments": segments}


def align_text(model: Any, audio_path: str, text: str, language: str | None = None):
    kwargs: dict[str, Any] = {"audio": audio_path, "text": text}
    if language:
        kwargs["language"] = language
    result = model.generate(**kwargs)
    items = []
    for it in result:
        items.append(
            {
                "text": getattr(it, "text", None),
                "start": float(getattr(it, "start_time", 0.0)),
                "end": float(getattr(it, "end_time", 0.0)),
            }
        )
    return items


def _default_speaker(model: Any, language: str | None) -> str | None:
    """Pick a CustomVoice speaker when the caller did not send one."""
    speakers = list(getattr(model, "supported_speakers", None) or [])
    if not speakers:
        return None
    preferred = DEFAULT_SPEAKER_BY_LANG.get(language or "")
    if preferred:
        for name in speakers:
            if name.lower() == preferred.lower():
                return name
    return speakers[0]


def _collect_audio(results: Any) -> tuple[Any, int]:
    import numpy as np  # type: ignore

    chunks = []
    sample_rate = 24000
    for r in results:
        audio = getattr(r, "audio", r)
        sr = getattr(r, "sample_rate", None)
        if sr:
            sample_rate = int(sr)
        chunks.append(np.asarray(audio))
    if not chunks:
        raise RuntimeError("TTS produced no audio")
    arr = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
    return arr, sample_rate


def tts_synthesize(
    model: Any,
    text: str,
    voice: str | None = None,
    language: str | None = None,
    instruct: str | None = None,
    mode: str = "preset",
    temperature: float | None = None,
):
    temp = TTS_TEMPERATURE if temperature is None else temperature
    if mode == "design" and hasattr(model, "generate_voice_design"):
        results = model.generate_voice_design(
            text=text,
            language=language,
            instruct=instruct or DEFAULT_DESIGN_INSTRUCT,
            temperature=temp,
        )
    elif hasattr(model, "generate_custom_voice"):
        speaker = voice or _default_speaker(model, language)
        results = model.generate_custom_voice(
            text=text,
            speaker=speaker,
            language=language,
            instruct=instruct or DEFAULT_INSTRUCT,
            temperature=temp,
        )
    else:
        kwargs: dict[str, Any] = {"voice": voice, "temperature": temp}
        if language:
            kwargs["lang_code"] = language
        if instruct or DEFAULT_INSTRUCT:
            kwargs["instruct"] = instruct or DEFAULT_INSTRUCT
        results = model.generate(text, **kwargs)

    if not isinstance(results, (list, tuple)):
        results = list(results)
    arr, sample_rate = _collect_audio(results)
    return arr, sample_rate


def write_wav(path: str | Path, arr: Any, sample_rate: int) -> None:
    import soundfile as sf  # type: ignore

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), arr, sample_rate)
