"""
tutor speech gateway.

A thin HTTP wrapper around the local MLX models so the Bun app can treat speech
as a service it can start, use, and let die (docs/DESIGN.md §8, §9).

Run:  uv run python -m speech.server
Env:  TUTOR_SPEECH_PORT (4319), TUTOR_SPEECH_IDLE_TIMEOUT (3600),
      TUTOR_SPEECH_EXIT_ON_IDLE (true)
"""

from __future__ import annotations

import logging
import math
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import models
from .models import Manager

logging.basicConfig(
    level=os.environ.get("TUTOR_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("speech.server")

manager = Manager()

app = FastAPI(title="tutor speech gateway", version="0.0.0")


@app.on_event("startup")
def _startup() -> None:
    manager.start_watchdog()
    log.info("gateway up — idle timeout %.0fs, exit_on_idle=%s", manager.idle_timeout_s, manager.exit_on_idle)


@app.on_event("shutdown")
def _shutdown() -> None:
    manager.stop_watchdog()
    manager.unload_all()


# --- helpers -----------------------------------------------------------------

def _is_cjk(ch: str) -> bool:
    o = ord(ch)
    return (
        0x3040 <= o <= 0x30FF  # kana
        or 0x3400 <= o <= 0x4DBF  # CJK extension A
        or 0x4E00 <= o <= 0x9FFF  # CJK unified
        or 0xF900 <= o <= 0xFAFF
        or 0xAC00 <= o <= 0xD7AF  # hangul
    )


def expected_speech_seconds(text: str) -> float:
    """Rough duration a measured reading of `text` should take.

    A TTS model occasionally fails to emit its end-of-speech token and keeps
    "reading" filler after a short word (`これ` → “これ、うん、これ”). Extra speech
    always pushes the clip past what the text can plausibly need, so the TTS
    route checks this estimate and retries an over-long take.
    """
    t = text.strip()
    if not t:
        return 0.6
    cjk = sum(1 for ch in t if _is_cjk(ch))
    other = sum(1 for ch in t if not _is_cjk(ch) and ch.isalnum())
    return 0.35 + 0.30 * cjk + 0.075 * other


def _speech_token_cap(text: str) -> int:
    """Stop a runaway generation early: ~12.5 speech tokens per second."""
    seconds = expected_speech_seconds(text)
    return max(24, min(2048, math.ceil(seconds * 12.5 * 1.8) + 12))


def to_wav16k(src: Path) -> Path:
    """
    Normalise any uploaded audio to 16 kHz mono WAV for the ASR models.

    Never trust the extension: browsers send webm/opus (and other clients send
    mp4/ogg) that our own routes sometimes carry under a `.wav` name, so always
    let ffmpeg sniff the container.
    """
    dst = src.with_suffix(".16k.wav")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(src), "-ar", "16000", "-ac", "1", str(dst)],
            check=True,
            capture_output=True,
        )
        return dst
    except Exception as exc:
        log.warning("ffmpeg normalise failed (%s); passing file through", exc)
        return src


async def _save_upload(file: UploadFile) -> Path:
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    fd, name = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    path = Path(name)
    path.write_bytes(await file.read())
    return path


# --- routes ------------------------------------------------------------------


@app.get("/")
def root() -> dict:
    return {"name": "tutor speech gateway", "models": models.SINGLE, "tts": models.TTS}


@app.get("/health")
def health() -> dict:
    resident = manager.resident()
    return {
        "ready": len(resident) > 0,
        "models": resident,
        "rssBytes": models._rss_bytes(),
        "mlx": models.mlx_memory(),
        "lastActivity": manager.last_activity,
        "idleTimeoutMs": manager.idle_timeout_s * 1000,
        "idleForMs": (time.time() - manager.last_activity) * 1000,
    }


@app.post("/admin/unload")
def unload() -> dict:
    return manager.unload_all()


def _warm_clip(seconds: float = 0.6) -> Path:
    """A short silent 16 kHz WAV used to trigger a model's compile/graph cost."""
    import numpy as np  # type: ignore
    import soundfile as sf  # type: ignore

    fd, name = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    sf.write(name, np.zeros(int(16000 * seconds), dtype="float32"), 16000)
    return Path(name)


@app.post("/v1/warm")
def warm() -> dict:
    """
    Load the voice models ahead of the first request, then run one tiny inference
    each so the first real play/record skips both the load and the compile cost.
    Idempotent: warm models answer instantly.
    """
    warmed: list[str] = []
    failed: dict[str, str] = {}
    clip: Path | None = None
    try:
        clip = _warm_clip()
        with manager.inference():
            try:
                models.tts_synthesize(
                    manager.get("tts_preset"),
                    "你好",
                    voice=None,
                    language="zh",
                    # warm the voice-design path too: the tutor always sends an
                    # `instruct`, so this is the branch the first real clip uses.
                    instruct=models.DEFAULT_VOICE_INSTRUCT,
                )
                warmed.append("tts_preset")
            except Exception as exc:  # pragma: no cover - depends on the local models
                log.warning("warm tts_preset failed: %s", exc)
                failed["tts_preset"] = str(exc)
            for kind in ("asr", "align"):
                try:
                    model = manager.get(kind)
                    if kind == "asr":
                        models.asr_transcribe(model, str(clip), "zh")
                    else:
                        models.align_text(model, str(clip), "你好", "zh")
                    warmed.append(kind)
                except Exception as exc:  # pragma: no cover - depends on the local models
                    log.warning("warm %s failed: %s", kind, exc)
                    failed[kind] = str(exc)
    finally:
        if clip:
            clip.unlink(missing_ok=True)
    manager.touch()
    return {"ok": not failed, "models": manager.resident(), "warmed": warmed, "failed": failed}


@app.post("/v1/asr")
async def asr(
    file: UploadFile = File(...),
    language: str | None = Form(None),
    hint: str | None = Form(None),
    lite: bool = Form(False),
) -> dict:
    path = await _save_upload(file)
    try:
        wav = to_wav16k(path)
        if not models.has_speech(str(wav)):
            # Don't let a silent/short clip become a hallucinated word (see models.has_speech).
            return {"text": "", "segments": [], "lang": language, "ms": 0.0, "noSpeech": True}
        with manager.inference():
            model = manager.get("asr_lite" if lite else "asr")
            t0 = time.time()
            out = models.asr_transcribe(model, str(wav), language, hint)
            ms = (time.time() - t0) * 1000
        return {"text": out["text"], "segments": out["segments"], "lang": language, "ms": ms}
    finally:
        path.unlink(missing_ok=True)


@app.post("/v1/align")
async def align(
    file: UploadFile = File(...),
    text: str = Form(...),
    language: str | None = Form(None),
) -> dict:
    path = await _save_upload(file)
    try:
        wav = to_wav16k(path)
        with manager.inference():
            model = manager.get("align")
            items = models.align_text(model, str(wav), text, language)
        return {"items": items}
    finally:
        path.unlink(missing_ok=True)


@app.post("/v1/assess")
async def assess(
    file: UploadFile = File(...),
    text: str = Form(...),
    language: str | None = Form(None),
) -> dict:
    """One shot for pronunciation: transcribe the attempt + align it to `text`."""
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    path = await _save_upload(file)
    try:
        wav = to_wav16k(path)
        try:
            import soundfile as sf

            info = sf.info(str(wav))
            duration = float(info.frames) / float(info.samplerate or 1)
        except Exception:
            duration = 0.0
        if not models.has_speech(str(wav)):
            # Silent/short attempt: report no speech rather than aligning silence
            # and grading a hallucinated transcript.
            return {"transcript": "", "items": [], "duration": duration, "noSpeech": True}
        t0 = time.time()
        with manager.inference():
            asr = manager.get("asr")
            # No `hint`/hotwords: Whisper's initial prompt leaks into a short take,
            # so biasing it with the deck vocabulary makes the model read a course
            # word back instead of the learner's (saying いる, hearing います).
            # The transcript must report what was actually said; the aligner, which
            # is given `text`, is what anchors the attempt to the expected answer.
            transcript = models.asr_transcribe(asr, str(wav), language, reference=text)
            aligner = manager.get("align")
            items = models.align_text(aligner, str(wav), text, language)
        return {
            "transcript": transcript["text"],
            "items": items,
            "duration": duration,
            "ms": (time.time() - t0) * 1000,
        }
    finally:
        path.unlink(missing_ok=True)


class TtsRequest(BaseModel):
    text: str
    voice: str | None = None
    language: str | None = None
    instruct: str | None = None
    mode: str = "preset"  # "preset" | "design"


@app.post("/v1/tts")
def tts(req: TtsRequest) -> Response:
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="empty text")
    kind = "tts_preset"
    expected = expected_speech_seconds(req.text)
    # Anything this many times longer than the text can possibly take has
    # picked up filler or a repeated word; take another sample instead.
    limit = expected * 2.0
    cap = _speech_token_cap(req.text)
    attempts = max(1, int(os.environ.get("TUTOR_TTS_ATTEMPTS", "3")))

    best: tuple[float, Any, int] | None = None  # (distance from expected, audio, rate)
    with manager.inference():
        model = manager.get(kind)
        for _ in range(attempts):
            arr, sr = models.tts_synthesize(
                model,
                req.text,
                voice=req.voice,
                language=req.language,
                instruct=req.instruct,
                mode=req.mode,
                max_tokens=cap,
            )
            if arr is None or len(arr) == 0:
                continue
            seconds = len(arr) / float(sr or 1)
            distance = abs(seconds - expected)
            # Keep the take closest to a plausible length as a fallback.
            if best is None or distance < best[0]:
                best = (distance, arr, sr)
            if seconds <= limit:
                break

    if best is None:
        raise HTTPException(status_code=500, detail="TTS produced no audio")
    _, arr, sr = best
    fd, name = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    models.write_wav(name, arr, sr)
    data = Path(name).read_bytes()
    Path(name).unlink(missing_ok=True)
    return Response(content=data, media_type="audio/wav", headers={"x-sample-rate": str(sr)})


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("TUTOR_SPEECH_PORT", "4319"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
