"""
tutor speech gateway.

A thin HTTP wrapper around the local MLX models so the Bun app can treat speech
as a service it can start, use, and let die (docs/DESIGN.md §8, §9).

Run:  uv run python -m speech.server
Env:  TUTOR_SPEECH_PORT (4319), TUTOR_SPEECH_IDLE_TIMEOUT (600),
      TUTOR_SPEECH_EXIT_ON_IDLE (true)
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import time
from pathlib import Path

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

# short code -> Qwen language name (used by TTS/align)
_LANGS = {
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


def lang_name(code: str | None) -> str | None:
    if not code:
        return None
    return _LANGS.get(code.lower(), code)


def to_wav16k(src: Path) -> Path:
    """Normalise any uploaded audio to 16 kHz mono WAV for the ASR models."""
    if src.suffix.lower() == ".wav":
        return src
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
        with manager.inference():
            model = manager.get("asr_lite" if lite else "asr")
            t0 = time.time()
            out = models.asr_transcribe(model, str(wav), lang_name(language), hint)
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
            items = models.align_text(model, str(wav), text, lang_name(language))
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
        t0 = time.time()
        with manager.inference():
            asr = manager.get("asr")
            transcript = models.asr_transcribe(asr, str(wav), lang_name(language))
            aligner = manager.get("align")
            items = models.align_text(aligner, str(wav), text, lang_name(language))
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
    kind = "tts_design" if req.mode == "design" else "tts_preset"
    with manager.inference():
        model = manager.get(kind)
        arr, sr = models.tts_synthesize(
            model,
            req.text,
            voice=req.voice,
            language=lang_name(req.language),
            instruct=req.instruct,
            mode=req.mode,
        )
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
