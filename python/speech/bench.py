"""
End-to-end smoke + benchmark for the speech stack. Run inside the dev shell:

    just bench        # cd python && uv run python -m speech.bench

It synthesises a phrase with TTS, transcribes it with ASR, aligns it, then unloads
and shows the RAM that came back. This is the Phase 1 acceptance test for this Mac.
"""

from __future__ import annotations

import tempfile
import time
from pathlib import Path

from . import models
from .models import Manager

PHRASE = "你好，我是一个语言学习助手。"
INSTRUCT = "A calm, professional language teacher with clear articulation."
LANG = "zh"
EN_PHRASE = "Hello, I am a language learning assistant."


def mb(n: int | None) -> str:
    return "n/a" if n is None else f"{n / 1e6:.0f} MB"


def mem(m: dict[str, int | None]) -> str:
    return f"mlx active={mb(m.get('active'))} peak={mb(m.get('peak'))} cache={mb(m.get('cache'))}"


def main() -> None:
    mgr = Manager(exit_on_idle=False)
    print(f"start: rss={mb(models._rss_bytes())}  {mem(models.mlx_memory())}")

    # --- cold start: load each model, timed individually ---
    for kind in ("tts_preset", "asr", "align"):
        t0 = time.time()
        mgr.get(kind)
        print(f"[load] {kind:<11} {time.time() - t0:5.2f}s   {mem(models.mlx_memory())}")

    # --- warm-up calls (first inference pays compile/graph cost) ---
    with mgr.inference():
        models.tts_synthesize(mgr.get("tts_preset"), "预热。", language=LANG, instruct=INSTRUCT)
    fd0, warm = tempfile.mkstemp(suffix=".wav")
    models.write_wav(warm, *models.tts_synthesize(mgr.get("tts_preset"), "预热。", language=LANG, instruct=INSTRUCT))
    with mgr.inference():
        models.asr_transcribe(mgr.get("asr"), warm, LANG)
        models.align_text(mgr.get("align"), warm, "预热", LANG)
    Path(warm).unlink(missing_ok=True)
    print(f"warmed: rss={mb(models._rss_bytes())}  {mem(models.mlx_memory())}")

    # --- TTS ---
    t0 = time.time()
    with mgr.inference():
        arr, sr = models.tts_synthesize(
            mgr.get("tts_preset"), PHRASE, language=LANG, instruct=INSTRUCT, mode="preset"
        )
    t_tts = time.time() - t0
    dur = len(arr) / sr
    print(f"[TTS]   {t_tts:5.2f}s  audio {dur:.2f}s @ {sr}Hz  RTF {t_tts / max(dur, 1e-6):.2f}")

    fd, name = tempfile.mkstemp(suffix=".wav")
    models.write_wav(name, arr, sr)

    # --- ASR (Chinese) ---
    t0 = time.time()
    with mgr.inference():
        out = models.asr_transcribe(mgr.get("asr"), name, language=LANG)
    print(f"[ASR]   {time.time() - t0:5.2f}s  -> {out['text']!r}")

    # --- Forced alignment ---
    t0 = time.time()
    with mgr.inference():
        items = models.align_text(mgr.get("align"), name, PHRASE, language=LANG)
    print(f"[ALIGN] {time.time() - t0:5.2f}s  {len(items)} words")
    for it in items[:8]:
        print(f"    [{it['start']:.2f}-{it['end']:.2f}] {it['text']}")

    print(f"peak:  rss={mb(models._rss_bytes())}  {mem(models.mlx_memory())}")

    # --- English TTS (second language sanity check) ---
    t0 = time.time()
    with mgr.inference():
        _, _ = models.tts_synthesize(
            mgr.get("tts_preset"), EN_PHRASE, language="en", instruct=INSTRUCT
        )
    print(f"[TTS/EN] {time.time() - t0:5.2f}s")

    Path(name).unlink(missing_ok=True)

    # --- Unload → RAM back to the Mac ---
    res = mgr.unload_all()
    time.sleep(0.5)
    print(
        f"after unload: rss {mb(res['rssBefore'])} -> {mb(res['rssAfter'])}  "
        f"mlx active {mb(res['mlxBefore'].get('active'))} -> {mb(res['mlxAfter'].get('active'))}"
    )


if __name__ == "__main__":
    main()
