#!/usr/bin/env python3
"""
Builds `apps/server/src/deck/mandarin-readings.txt`, the bundled Mandarin
reading table the deck generator and backfill look up (docs/DESIGN.md §11.1).

Sources (both are Taiwan Mandarin, which is what Zhuyin is used for):

* **中華民國教育部《重編國語辭典修訂本》** — the standard Taiwan readings, via the
  g0v/moedict-data mirror (https://github.com/g0v/moedict-data). Its public data
  is CC BY-ND 3.0 TW; the ministry permits format conversion and downstream use,
  so the readings are carried over verbatim. Multi-character words come from here.
* **McBopomofo** (https://github.com/openvanilla/McBopomofo, MIT) — an input-method
  dictionary. Its `heterophony1.list` gives each character's *preferred* reading
  (the ministry lists character readings in alphabetical order, not by frequency),
  `BPMFBase.txt` fills single characters it omits, and `BPMFMappings.txt` fills
  words the ministry dictionary does not list.

Output: one `<word>\t<zhuyin>` line per entry, Zhuyin with tone marks (space
separated syllables, neutral tone written `˙ㄅ…`).

Usage:  python3 scripts/build-mandarin-readings.py
"""

from __future__ import annotations

import json
import lzma
import re
import tempfile
import urllib.request
from pathlib import Path

MOE_URL = "https://raw.githubusercontent.com/g0v/moedict-data/main/dict-revised.json.xz"
MCB_BASE = "https://raw.githubusercontent.com/openvanilla/McBopomofo/master/Source/Data"
MCB_FILES = ["heterophony1.list", "BPMFBase.txt", "BPMFMappings.txt"]

OUT = Path(__file__).resolve().parent.parent / "apps/server/src/deck/mandarin-readings.txt"
CACHE = Path(tempfile.gettempdir()) / "tutor-mandarin-build"

HAN = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
# 兒化: the ministry writes the suffix glued to the syllable (ㄉㄧㄢˇㄦ) and pads
# with stray spaces; normalise to single-space-separated syllables.
SPACE = re.compile(r"\s+")


def download(name: str, url: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print(f"fetching {url}")
        with urllib.request.urlopen(url) as res:
            path.write_bytes(res.read())
    return path.read_bytes()


def clean(zhuyin: str) -> str:
    return SPACE.sub(" ", zhuyin).strip()


def decode_title(raw: str) -> str:
    """The ministry encodes a rare character as `{[<codepoint hex>]}`."""
    m = re.fullmatch(r"\{\[([0-9a-fA-F]+)\]\}", raw or "")
    return chr(int(m.group(1), 16)) if m else (raw or "")


def mcb_readings() -> tuple[dict[str, str], dict[str, str]]:
    out: dict[str, str] = {}
    # single characters: the preferred reading, then the base table
    for line in download("BPMFBase.txt", f"{MCB_BASE}/BPMFBase.txt").decode().splitlines():
        parts = line.split(" ")
        if len(parts) >= 2 and len(parts[0]) == 1 and HAN.fullmatch(parts[0]):
            out.setdefault(parts[0], parts[1])
    for line in download("heterophony1.list", f"{MCB_BASE}/heterophony1.list").decode().splitlines():
        parts = line.strip().split(" ")
        if len(parts) >= 2 and len(parts[0]) == 1 and HAN.fullmatch(parts[0]):
            out[parts[0]] = " ".join(parts[1:])
    # words: the first mapping per word (the input method lists the common one first)
    words: dict[str, str] = {}
    for line in download("BPMFMappings.txt", f"{MCB_BASE}/BPMFMappings.txt").decode().splitlines():
        parts = line.split(" ")
        if len(parts) >= 2 and len(parts[0]) >= 2:
            words.setdefault(parts[0], " ".join(parts[1:]))
    return out, words


def moe_readings() -> dict[str, str]:
    raw = lzma.decompress(download("dict-revised.json.xz", MOE_URL))
    data = json.loads(raw)
    out: dict[str, str] = {}
    for entry in data:
        title = decode_title(entry.get("title"))
        if not title or not HAN.search(title):
            continue
        for heteronym in entry.get("heteronyms") or []:
            bopomofo = heteronym.get("bopomofo")
            if bopomofo:
                out.setdefault(title, clean(bopomofo))
                break
    return out


def main() -> None:
    chars, mcb_words = mcb_readings()
    moe = moe_readings()

    table: dict[str, str] = dict(chars)
    for word, zhuyin in moe.items():
        if len(word) >= 2:
            table.setdefault(word, zhuyin)
    for word, zhuyin in mcb_words.items():
        table.setdefault(word, clean(zhuyin))

    lines = [f"{word}\t{table[word]}" for word in sorted(table)]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {len(lines)} entries to {OUT}")


if __name__ == "__main__":
    main()
