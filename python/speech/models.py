"""
Model registry + lifecycle manager for the speech gateway.

Design goals (docs/DESIGN.md §5, §8):
  * lazy load models on first use
  * keep only ONE TTS checkpoint resident at a time
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
#
# ASR is Whisper large-v3-turbo (OpenAI): the distilled large-v3 decoder, ~809M
# params, 99 languages, and the best speed/accuracy trade of the Whisper family.
# It is autoregressive, so the energy VAD guard still matters, but it accepts
# `hotwords` (folded into Whisper's initial prompt), so the deck vocabulary in
# play really does bias decoding. TTS is VoxCPM2 (OpenBMB): a 2B tokenizer-free
# multilingual model whose `instruct` argument designs a voice from a
# description, so one checkpoint covers every language the app offers *and* the
# "describe your tutor" feature. Both run on MLX through `mlx-audio`.

ASR_MODEL = os.environ.get("TUTOR_ASR", "mlx-community/whisper-large-v3-turbo-asr-fp16")
# Whisper ships one size per family; the "lite" path aliases it unless overridden.
ASR_LITE_MODEL = os.environ.get("TUTOR_ASR_LITE", ASR_MODEL)
ALIGN_MODEL = os.environ.get("TUTOR_ALIGN", "mlx-community/Qwen3-ForcedAligner-0.6B-8bit")
# VoxCPM2 ships bf16 (5.0 GB) / 8-bit (3.2 GB) / 4-bit (2.3 GB). 8-bit keeps the
# quality while leaving room for ASR + aligner + browser in 16 GB.
TTS_PRESET_MODEL = os.environ.get("TUTOR_TTS_PRESET", "mlx-community/VoxCPM2-8bit")

# Roles that map to a fixed checkpoint.
SINGLE = {"asr": ASR_MODEL, "asr_lite": ASR_LITE_MODEL, "align": ALIGN_MODEL}
# One TTS checkpoint, loaded lazily like the rest.
TTS = {"tts_preset": TTS_PRESET_MODEL}
# Roles that share a checkpoint, so the same weights are never loaded twice.
_ALIASES = {"asr_lite": "asr"} if ASR_LITE_MODEL == ASR_MODEL else {}

# The voice the tutor speaks in when a caller sends no description of its own.
# VoxCPM2 has no named speakers, so this *description* is what keeps one
# consistent teacher across a whole deck.
DEFAULT_VOICE_INSTRUCT = os.environ.get(
    "TUTOR_TTS_INSTRUCT",
    "A calm, professional language teacher with clear and precise articulation, "
    "a warm and friendly tone, a steady measured pace and natural intonation.",
)


# --- language codes -----------------------------------------------------------
#
# The app speaks in short codes (zh, ja, en, …); each backend wants a different
# spelling, so translate at the adapter rather than at the HTTP edge.

# Whisper takes ISO codes and auto-detects when the code is omitted; its set
# covers every language the app offers, including Cantonese ("yue").
WHISPER_LANGS = {"zh", "yue", "en", "ja", "ko", "de", "fr", "es", "it", "pt", "ru"}
# The forced aligner wants the spelled-out language name.
ALIGN_LANG_NAMES = {
    "zh": "Chinese",
    "yue": "Cantonese",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
}


def whisper_language(code: str | None) -> str | None:
    """Short app code → Whisper ISO code, or None to auto-detect."""
    c = (code or "").strip().lower()
    return c if c in WHISPER_LANGS else None


def align_language(code: str | None) -> str | None:
    """Short app code → spelled-out name the forced aligner expects."""
    if not code:
        return None
    return ALIGN_LANG_NAMES.get(code.lower(), code)


def model_id(kind: str) -> str:
    if kind in SINGLE:
        return SINGLE[kind]
    if kind in TTS:
        return TTS[kind]
    raise KeyError(kind)


def _load_model(kind: str, repo: str) -> Any:
    log.info("loading %s (%s)", kind, repo)
    t0 = time.time()
    if kind in ("asr", "asr_lite", "align"):
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
    idle_timeout_s: float = float(os.environ.get("TUTOR_SPEECH_IDLE_TIMEOUT", "3600"))
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
        kind = _ALIASES.get(kind, kind)
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

# A clip with less than this much speech-like energy is treated as "no speech".
_MIN_SPEECH_S = 0.12
# Below this peak a clip is silence/room tone, never a phrase (float32 samples).
_MIN_PEAK = 4e-3


def speech_seconds(audio_path: str) -> float:
    """
    Seconds of speech-like energy in a clip (a cheap energy VAD).

    ASR models are eager: fed silence or a clipped fragment, even a CTC model can
    emit a stray token and an autoregressive one can invent a whole phrase
    ("Okay.", "Written.", "嗯。"), which then looks like a transcription error to
    the learner. We only run the recogniser when there is something to recognise.
    Returns -1.0 when the audio cannot be read (caller should not block).
    """
    import numpy as np  # type: ignore
    import soundfile as sf  # type: ignore

    try:
        x, sr = sf.read(audio_path, dtype="float32")
    except Exception as exc:  # pragma: no cover - unreadable file
        log.debug("speech_seconds: cannot read %s (%s)", audio_path, exc)
        return -1.0
    sr = int(sr or 16000)
    if getattr(x, "ndim", 1) > 1:
        x = x.mean(axis=1)
    if len(x) == 0:
        return 0.0
    peak = float(np.max(np.abs(x)))
    if peak < _MIN_PEAK:
        return 0.0
    frame = max(1, int(0.02 * sr))
    n = len(x) // frame
    if n == 0:
        return 0.0
    rms = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1))
    # Frame is "voiced" when it rises clearly above the clip's own noise floor.
    active = int(np.count_nonzero(rms > max(peak * 0.05, 2e-3)))
    return active * (frame / sr)


def has_speech(audio_path: str) -> bool:
    seconds = speech_seconds(audio_path)
    if seconds < 0:  # unreadable → don't second-guess the model
        return True
    return seconds >= _MIN_SPEECH_S


def _is_whisper(model: Any) -> bool:
    return "whisper" in type(model).__module__.lower()


def _is_voxcpm(model: Any) -> bool:
    return "voxcpm" in type(model).__module__.lower()


def match_script(text: str, reference: str | None) -> str:
    """
    Align a transcript to the script the caller is working in.

    Whisper's Mandarin output can come back Simplified, so a learner reading a
    Traditional deck would see every card as a transcription error. When the
    reference (the expected text, or the deck vocabulary passed as `hint`) is
    Traditional, convert the transcript to Traditional too. Simplified and
    non-Chinese references are left untouched.
    """
    if not text or not reference:
        return text
    try:
        import zhconv  # type: ignore
    except Exception:  # pragma: no cover - dependency is pinned in pyproject
        return text
    if zhconv.convert(reference, "zh-hans") == reference:
        return text  # reference is Simplified (or not Chinese)
    return zhconv.convert(text, "zh-hant")


def asr_transcribe(
    model: Any,
    audio_path: str,
    language: str | None = None,
    hint: str | None = None,
    reference: str | None = None,
):
    """
    Transcribe with Whisper.

    Whisper takes ISO language codes (omit → auto-detect) and a `hotwords` list
    that it folds into its initial prompt, so the deck vocabulary passed as
    `hint` biases decoding.

    Caution: on a short take the decoder tends to *continue* that prompt instead
    of listening to the audio, so `hint` can make Whisper read a course word back
    that was never spoken. Pronunciation assessment (`/v1/assess`) therefore does
    not pass one — see `server.assess`.
    """
    words = [w.strip() for w in hint.split(",") if w.strip()] if hint else []

    if not _is_whisper(model):
        raise ValueError(f"unsupported ASR checkpoint: {type(model).__module__}")
    result = model.generate(
        audio_path,
        language=whisper_language(language),
        hotwords=words or None,
    )

    text = getattr(result, "text", None)
    if text is None and isinstance(result, dict):
        text = result.get("text", "")
    return {
        "text": match_script(text or "", reference or hint),
        "segments": _asr_segments(result),
        "lang": getattr(result, "language", None),
    }


def _asr_segments(result: Any) -> list[dict[str, Any]]:
    """Normalise each family's segment shape to {text, start, end}."""
    raw = getattr(result, "segments", None)
    if raw is None and isinstance(result, dict):
        raw = result.get("segments", [])
    out: list[dict[str, Any]] = []
    for seg in raw or []:
        get = seg.get if isinstance(seg, dict) else lambda k, d=None, s=seg: getattr(s, k, d)
        out.append(
            {
                "text": get("text", "") or "",
                "start": float(get("start", 0.0) or 0.0),
                "end": float(get("end", 0.0) or 0.0),
            }
        )
    return out


def align_text(model: Any, audio_path: str, text: str, language: str | None = None):
    kwargs: dict[str, Any] = {"audio": audio_path, "text": text}
    name = align_language(language)
    if name:
        kwargs["language"] = name
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


def _voxcpm_synthesize(model: Any, text: str, instruct: str | None):
    """
    VoxCPM2 is tokenizer-free: it infers the language from the text and has no
    named voices. A description (`instruct`) switches it into voice-design mode,
    which is how the tutor pins one consistent teacher voice per language; with
    no description from the caller we fall back to the built-in teacher voice.
    """
    results = model.generate(text, instruct=instruct or DEFAULT_VOICE_INSTRUCT)
    return _collect_audio(results)


def tts_synthesize(
    model: Any,
    text: str,
    voice: str | None = None,
    language: str | None = None,
    instruct: str | None = None,
    mode: str = "preset",
    temperature: float | None = None,
    max_tokens: int | None = None,
):
    if not _is_voxcpm(model):
        raise ValueError(f"unsupported TTS checkpoint: {type(model).__module__}")
    return _voxcpm_synthesize(model, text, instruct)


def write_wav(path: str | Path, arr: Any, sample_rate: int) -> None:
    import soundfile as sf  # type: ignore

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), arr, sample_rate)
