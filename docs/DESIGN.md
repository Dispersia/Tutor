# Tutor — AI-first language learning app

> Design & execution plan. Status: **approved direction, ready for Phase 0**.
> Target: Apple **M6**, **16 GB** unified memory, macOS 27 (server) + **Android
> PWA** (primary client, mobile-first).
> One-liner: a local-first, Duolingo-like language tutor where the **brain is
> OpenRouter** (user-selectable model) and the **speech (TTS/ASR) is local Qwen3
> on MLX**, with permanent chat/voice history, an extensible card + exercise
> engine, and XP-based gamification.

---

## 1. Vision

A personal language-learning app you actually want to open every day. Where
Duolingo gives you canned multiple-choice, this gives you **conversation**:
you talk (or type) to an AI tutor, it answers out loud, and it drills you with
cards that can be as simple as "what is the English of this word?" or as rich as
"say this sentence and I'll tell you how your pronunciation was".

Core loop:

```
   ┌─────────────┐   pick/next    ┌──────────────┐   answer    ┌──────────────┐
   │  Curriculum │ ─────────────► │   Exercise   │ ──────────► │    Grade     │
   │  (cards)    │                │ (chat/voice) │             │ (rules + LLM)│
   └─────────────┘                └──────────────┘             └──────┬───────┘
          ▲                                                           │
          │                 XP, streaks, levels                       │
          └─────────────────────  game systems  ◄────────────────────┘
```

The point of the design below is **extensibility**: cards, exercise types, game
systems, speech backends and LLM roles should all be pluggable without
rewriting the core.

---

## 2. Goals & non-goals

### Goals (now)

- Local TTS + ASR using the **latest Qwen3 speech models that fit in 16 GB**.
- Brain via **OpenRouter** with **user-selectable models** (any key: Qwen,
  DeepSeek, OpenAI, …).
- **Multi-user**: separate accounts, isolated history, per-user settings and keys.
- **SvelteKit PWA**, mobile-first for Android, installable to the home screen.
- Web UI: chat mode and voice mode, both persisted forever.
- Extensible **card** and **exercise** type system.
- Pronunciation judging (approximate, word-level; see §9).
- Gamification skeleton: XP ledger, levels, streaks, daily goal.
- **Nix flake** for a reproducible dev shell _and_ a packaged, runnable app.
- **Speech models shut down when idle** to give RAM back to the Mac.

### Non-goals (later)

- Cloud sync / federation / SSO.
- Native (App Store) mobile apps.
- Training or fine-tuning models.
- Leaderboards, leagues, social features (game is built out later).

---

## 3. Target machine & constraints

| Item    | Value                            | Consequence                                    |
| ------- | -------------------------------- | ---------------------------------------------- |
| Chip    | Apple M6 (Apple Silicon, arm64)  | MLX/Metal works; arm64 wheels only             |
| RAM     | 16 GB unified                    | Models must stay ≲ 7 GB resident; idle unload  |
| OS      | macOS 27 (very new)              | Must verify MLX + wheels support; pin versions |
| Disk    | ~51 GB free on `/`               | Model cache ~6 GB is fine; audio history grows |
| Nix     | 2.34.9, nixpkgs-unstable         | Flake-based dev + packaging                    |
| Runtime | bun 1.4.4, node 24.22.2, python3 | Bun is primary; Python only for MLX            |

**Important:** the nix sandbox cannot use Metal, and model weights are multi-GB.
So the Nix flake provides _tools and the app_, while the **Python/MLX venv and
model weights live on disk outside the Nix store** (project `.venv`, `.models`,
or `$TUTOR_DATA_DIR`). See §14.

---

## 4. Research: the current Qwen speech landscape

### 4.1 ASR — Qwen3-ASR

- Open-weights family, sizes **0.6B** and **1.7B**, multilingual
  (Chinese, Cantonese, English, Japanese, Korean, German, Spanish, French,
  Italian, Portuguese, Russian).
- Beats Whisper-large-v3 on multiple benchmarks.
- MLX support is mature: [`mlx-audio`](https://github.com/Blaizzy/mlx-audio)
  ships `mlx-community/Qwen3-ASR-0.6B-8bit` and `Qwen3-ASR-1.7B-8bit`.
- Companion: **Qwen3-ForcedAligner-0.6B** gives **word-level timestamps** when
  you supply the expected text → this is our pronunciation-scoring backbone.

### 4.2 TTS — Qwen3-TTS

- Open-sourced **Jan 2026** (Apache-2.0), sizes **0.6B / 1.7B**, family:
  `CustomVoice` (preset speakers + emotion), `VoiceDesign` (voice from a text
  description), `Base` (3-second voice cloning).
- 10 languages (incl. Mandarin + Japanese), streaming with ~97 ms claimed
  first-packet latency, instruction control of tone/emotion.
- MLX ports exist in `mlx-audio` (`mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-*`,
  `...-0.6B-CustomVoice-*`, `...-VoiceDesign-bf16`, `...-Base-bf16`; quantized
  bf16/6-bit variants published).

### 4.3 The runtime — `mlx-audio` (Neywa Labs / Blaizzy)

- MIT. TTS + STT + STS + VAD + music, built on Apple **MLX**.
- **OpenAI-compatible REST server**: `POST /v1/audio/speech`,
  `POST /v1/audio/transcriptions` — so our app can treat speech like the OpenAI
  audio API but hit localhost.
- Supports streaming, quantization, VAD (Silero), forced alignment.
- Swift package (`mlx-audio-swift`) exists if we ever go native.

### 4.4 Too big for this Mac

- **Qwen3-Omni-30B-A3B** (~60 GB fp16, ~16 GB even at 4-bit + encoders) does not
  fit comfortably in 16 GB alongside a browser. **Rejected** for now; the
  cascade (LLM on OpenRouter + local Qwen3-ASR/TTS) is better here anyway because
  it keeps RAM low and gives us a much stronger "brain".

### 4.5 Cloud fallback

- OpenRouter launched **audio APIs (TTS + transcription)** in 2026. We can add a
  `cloud` speech provider behind the same gateway interface for when the local
  models are cold or on a second machine.

### 4.6 Nix findings

- `nixpkgs` has `uv`, `bun`, `nodejs_24`, `python312`, `ffmpeg` (verified on this
  machine). No reliable `mlx` in the store → install via `uv` into a project venv.
- MLX wheels are published for `macosx_*_arm64` cp310–cp313 → plain venv works.

---

## 5. Model selection (what we will actually run)

| Role             | Model (MLX)                                           | ~RAM    | Notes                                  |
| ---------------- | ----------------------------------------------------- | ------- | -------------------------------------- |
| **ASR**          | `mlx-community/Qwen3-ASR-1.7B-8bit`                   | ~2.0 GB | Best accuracy, ZH/JA/EN/…              |
| **ASR (lite)**   | `mlx-community/Qwen3-ASR-0.6B-8bit`                   | ~0.9 GB | Fast path / low-memory mode            |
| **Alignment**    | `mlx-community/Qwen3-ForcedAligner-0.6B-8bit`         | ~0.9 GB | Word timings → pronunciation scoring   |
| **TTS (preset)** | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit`¹ | ~2.5 GB | Built-in speakers + emotion, streaming |
| **TTS (design)** | `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16`  | ~3.5 GB | User-described voices (alt mode)       |
| **TTS (lite)**   | `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-*`     | ~1.5 GB | Lighter fallback                       |
| **VAD**          | `mlx-community/silero-vad`                            | tiny    | Turn detection / silence trimming      |
| **LLM (brain)**  | OpenRouter (cloud)                                    | 0       | Chat, grading, exercise generation     |

¹ Quantized variants are published (bf16/6-bit; use 8-bit if available, else
6-bit). Exact tag resolved at build time and pinned in `python/uv.lock`.

**Resident budget while active:** ASR 1.7B + aligner + **one** TTS checkpoint
(preset _or_ design) ≈ **~6 GB**, leaving ~9–10 GB for macOS + browser. The two TTS
checkpoints are **never both resident** — switching voice mode LRU-swaps them
(§8.3). **When idle, everything is released** (§8).

**Measured on this machine** (Apple M6 / 16 GB / macOS 27, `just bench`, after warm-up):

| Stage                     | Result                              |
| ------------------------- | ----------------------------------- |
| load TTS preset 1.7B-8bit | 2.5 s → 3.1 GB MLX                  |
| load ASR 1.7B-8bit        | 1.0 s → 5.6 GB cumulative           |
| load ForcedAligner 0.6B   | 0.7 s → 6.9 GB cumulative           |
| TTS (warm)                | **RTF 0.45** (2.7 s audio in 1.2 s) |
| ASR (warm, Mandarin)      | **0.5 s**, exact transcript         |
| Align (warm)              | **0.15 s**, word timings            |
| peak MLX memory           | 8.6 GB                              |
| **after `unload`**        | **MLX 6.9 GB → ~0** (RAM returned)  |

ASR-1.7B gave an exact transcript of the synthesised Mandarin; `Qwen3-ASR-0.6B`
is available to save ~1.5 GB if needed. Cold start (all three) ≈ **4 s**, hidden by
pre-warming when the user opens a voice exercise.

Design policy: models are chosen from a single `models.ts`/config so swapping to
the 0.6B lite variants on a smaller Mac is a config change, not a code change.

---

## 6. System architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                 Android phone (SvelteKit PWA, mobile-first)                   │
│   chat pane · voice recorder · card/exercise renderer · XP HUD                │
│   MediaRecorder ▸ PCM/WAV        ◂ Web Audio playback of TTS                  │
│   installable · offline shell · service worker                                │
└───────────────┬───────────────────────────────────────────────┬─────────────┘
                │ HTTPS + SSE (tokens)                          │ WAV chunks
                │ WebSocket (audio in/out, events)               │
┌───────────────▼───────────────────────────────────────────────▼─────────────┐
│                     Bun app server  (apps/server)                            │
│  Hono routes · SSE/WS · serves PWA static shell · SQLite(bun:sqlite)+Drizzle │
│  ┌───────────────┐  ┌────────────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │ LLM gateway   │  │ Exercise engine│  │ Game service  │  │ Speech client│  │
│  │ OpenRouter    │  │ registry       │  │ XP/streak     │  │ (gateway HTTP│  │
│  │ (stream,JSON) │  │ generate/grade │  │ event bus     │  │  + WS)       │  │
│  └───────────────┘  └────────────────┘  └───────────────┘  └──────┬───────┘  │
└──────────────────────────────────────────────────────────────────┼──────────┘
                    │ supervisor: lazy start / idle stop / health   │
┌───────────────────▼──────────────────────────────────────────────▼──────────┐
│                  Speech gateway  (python/speech, MLX, "sidecar")             │
│  ASR (Qwen3-ASR) · ForcedAligner · TTS (Qwen3-TTS) · VAD · mx.clear_cache()  │
│  Idle timer → unload models → exit (RAM back to macOS)                       │
└──────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼      OpenRouter (cloud)  ── chat / grading / generation
```

**Deployment shape:** the _Mac is the server_ (models + Bun + SQLite); phones and
laptops are thin PWA clients. The phone uploads audio, the Mac transcribes and
synthesises, and only text goes to OpenRouter. See §14.1 for the
**HTTPS / secure-context requirement** that this implies for phone microphones.

Why split the Python sidecar from the Bun server?

- MLX must run outside the Nix sandbox and needs its own process lifetime so it
  can be **killed to free RAM** (§8).
- One narrow interface (`/speech/*`) means we can later swap to OpenRouter's
  audio APIs, whisper.cpp, or a native Swift MLX service without touching the app.

Monorepo layout:

```
tutor/
  flake.nix  flake.lock  justfile  README.md
  apps/
    web/           # SvelteKit PWA (adapter-static, SPA) — mobile-first UI
    server/        # Bun + Hono API, SSE/WS, SQLite, serves PWA, speech supervisor
  packages/
    core/          # shared types, zod schemas, card/exercise registry contracts
    speech/        # TS client for the speech gateway + provider interface
    ui/            # shared Svelte components (cards, recorder, HUD)
  python/
    pyproject.toml # uv-managed deps: mlx-audio, mlx, soundfile, fastapi
    uv.lock
    speech/server.py   # FastAPI/uv app: ASR+TTS+aligner, idle unload
  nix/
    package.nix    # build SvelteKit assets + compile bun binary
    speech.nix     # sidecar wrapper / model-fetch script
  data/            # (gitignored) sqlite + audio blobs, see §15
  docs/
    DESIGN.md      # this file
```

---

## 7. Technology choices

| Layer         | Choice                                                              | Why                                                                                                                               |
| ------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Runtime       | **Bun**                                                             | Already installed; TS, `bun:sqlite`, bundler, WS, `--compile`                                                                     |
| API           | **Hono**                                                            | Tiny, fast, typed routing, works on Bun                                                                                           |
| DB            | **SQLite** (`bun:sqlite`) + **Drizzle**                             | Zero-ops local DB; Drizzle gives typed queries + migrations; easy future swap to Postgres                                         |
| Frontend      | **SvelteKit** (adapter-static, SPA mode) + Tailwind + shadcn-svelte | Most performant UI framework at runtime (compiled, no VDOM), tiny bundles, first-class PWA support — the mobile-first requirement |
| Client        | **PWA** (installable, offline shell)                                | Primary target is Android; installs from the browser, no app store, no native build                                               |
| Data fetching | SvelteKit `load` + stores, `@tanstack/svelte-query` where useful    | Streaming-friendly; optimistic XP updates                                                                                         |
| Validation    | **zod**                                                             | Shared contracts in `packages/core`; validates LLM JSON                                                                           |
| Speech        | **mlx-audio** (Python)                                              | Confirmed Qwen3-ASR/TTS MLX support, OpenAI-compatible API                                                                        |
| Brain         | **OpenRouter** REST/SSE                                             | Model-agnostic roles; one key; structured outputs                                                                                 |
| Packaging     | **Nix flake** + `bun build --compile`                               | Single binary + assets, wraps cleanly into a derivation                                                                           |

---

## 8. Speech lifecycle — idle shutdown (explicit requirement)

> "the models need to shut down when no one is on it to free space on the mac"

The speech gateway is **not** started at boot. A small **supervisor** in the Bun
server owns its lifecycle.

### 8.1 Startup: lazy, on first need

- Default `TUTOR_SPEECH_AUTOSTART=false`.
- The gateway process is spawned on the **first** speech request (or when the user
  opens a voice exercise, which pre-warms it).
- On spawn, the sidecar binds a localhost port and reports `/health` until models
  are loaded. First-utterance latency includes model load (~2–6 s). We hide this
  by pre-warming when the user enters a voice mode or clicks record.

### 8.2 Idle shutdown

- Every activity (an ASR call, a TTS call, an open WS audio stream, a client
  heartbeat) updates `lastActivity`.
- A reaper checks every 30 s: if `now - lastActivity > TUTOR_SPEECH_IDLE_TIMEOUT`
  (default **1 hour**) **and** the number of active audio WebSockets is 0 **and**
  no connected clients are in "voice" state → gracefully stop the sidecar.
- Graceful stop = `POST /admin/unload` (drop model refs, call
  `mlx.core.clear_cache()` / `mx.metal.clear_cache()`, then exit) → OS reclaims RAM.

### 8.3 Additional release triggers

- **Client gone:** when the last browser tab disconnects and stays gone for the
  idle window → unload.
- **Memory pressure:** poll `memory_pressure`/`sysctl vm.memory_pressure` and if
  the Mac is under pressure, unload the heaviest model first (TTS), keeping ASR
  for a fast reply is optional — configurable.
- **Explicit:** a "Free memory" button in Settings calls `unload`.
- **Idle inside the sidecar:** the sidecar also evicts least-recently-used models
  (e.g. drop VoiceDesign if unused) so we never hold all five variants at once.

### 8.4 Latency tradeoff (documented)

| State            | First-utterance cost                   |
| ---------------- | -------------------------------------- |
| Warm             | ~0.3–1 s (streaming TTS first packet)  |
| Cold start       | ~2–6 s model load (spinner + pre-warm) |
| Mid-conversation | Warm; idle timer keeps resetting       |

Config knobs: `TUTOR_SPEECH_IDLE_TIMEOUT`, `TUTOR_SPEECH_AUTOSTART`,
`TUTOR_SPEECH_MAX_RESIDENT_MODELS`, `TUTOR_SPEECH_MEMORY_PRESSURE_UNLOAD`.

### 8.5 App shutdown

The sidecar is a child of the app; on app exit the supervisor sends `SIGTERM`
and waits, then `SIGKILL`. Optional later: a launchd `KeepAlive=false` service via
a nix-darwin/Home Manager module.

---

## 9. Speech subsystem detail

### 9.1 Speech gateway API (our own, thin)

Wraps `mlx-audio`. Everything is localhost-only.

```
GET  /health                         → { ready, models:[...], rss, lastActivity }
POST /admin/unload                   → drop models, clear cache, exit
POST /v1/asr                         → { audio: base64|multipart, language?, hint? }
                                        → { text, segments[], lang, conf? }
POST /v1/align                       → { audio, text, language } → word timings
POST /v1/tts                         → { text, voice, language?, instruct?, stream }
                                        → audio/wav  (or chunked stream)
WS   /v1/tts/stream                  → send text, receive PCM/WAV chunks
WS   /v1/asr/stream                  → send audio frames, receive partial text
```

The gateway **defaults to the OpenAI-compatible shape** from `mlx-audio` where
possible, and adds `/v1/align` + admin/lifecycle routes.

### 9.2 TTS flow (fed by the OpenRouter response)

```
OpenRouter token stream ─► sentence splitter ─► /v1/tts (stream) ─► Web Audio
        (text)                 (incremental)        (per sentence)     (play)
```

- Chunk by sentence so playback starts before the full reply is generated.
- Voice mapping per target language + exercise mood (e.g. `Vivian`/`Serena` for
  Mandarin, `Ono_Anna` for Japanese, `Ryan`/`Aiden` for English, `Sohee` for
  Korean) — all presets of `CustomVoice`, so no cloning needed for MVP.
- `instruct` lets an exercise ask for a specific tone ("encouraging and slow").

#### Voice options (what "voice strategy" means)

All three are capabilities of the same Qwen3-TTS family; you can mix them per
language or per exercise:

| Option                            | What it is                                                                                                               | Setup       | Best for                                                                     | Cost    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------- | ------- |
| **CustomVoice** (preset speakers) | The model ships named voices. You just pass `speaker="Vivian"`.                                                          | none        | The default tutor voice per language; consistent everywhere                  | lowest  |
| **VoiceDesign**                   | You describe a voice in text ("a warm, patient female teacher in her 30s, slow clear articulation") and it _invents_ it. | none        | A distinctive tutor persona; different voices per character in roleplay      | medium  |
| **Base / voice clone**            | Give a 3-second clip + its transcript; it speaks in that voice.                                                          | need a clip | Your tutor sounding like a specific real person, or a fixed custom character | highest |

Preset speakers already shipped by `CustomVoice`:

- Mandarin: `Vivian`, `Serena`, `Uncle_Fu`, `Dylan` (Beijing), `Eric` (Sichuan)
- English: `Ryan`, `Aiden`
- Japanese: `Ono_Anna`
- Korean: `Sohee`

**Recommendation:** expose **both CustomVoice and VoiceDesign as user-selectable
voice modes** in Settings — they're two variants of the same Qwen3-TTS family, so
letting the user pick costs nothing and covers both tastes:

- **Preset mode (CustomVoice):** pick one of the built-in speakers per language
  (fast, consistent, lowest memory).
- **Design mode (VoiceDesign):** describe a voice in a sentence and save it as a
  named persona the user can reuse (e.g. "patient Mandarin teacher, warm, slow").
  A designed voice can be saved and reused like a preset.

Because the two models exist as separate checkpoints, **keep only one TTS
checkpoint resident at a time** and LRU-swap when the user switches mode (§8.3) —
holding both plus ASR + aligner would blow the 16 GB budget. Voice **cloning**
stays Phase 8. Everything is config-driven (`voiceFor(lang, mode)`), so switching
never touches code.

### 9.3 ASR flow

```
record (MediaRecorder) ─► 16 kHz mono WAV ─► /v1/asr (lang hint) ─► transcript
```

- Convert to 16 kHz mono server-side with `ffmpeg` (nix-provided) or in-browser
  via AudioWorklet PCM.
- Language hint improves accuracy; auto-detect is the fallback.
- **Context biasing:** the caller may pass `hint` (a comma-separated word list →
  Qwen3-ASR `hotwords`), e.g. the deck vocabulary in play, so a half-heard course
  word is not replaced by an unrelated one.
- **No-speech guard:** Qwen3-ASR is generative — fed silence or a clipped
  fragment it invents a word ("Okay.", "Written.", "嗯。"). The gateway computes a
  cheap energy VAD (`models.has_speech`) and returns `{ text: "", noSpeech: true }`
  for silent/too-short clips instead of hallucinating.
- Streaming ASR (WS) is Phase-2 for low-latency turn-taking + barge-in.

### 9.4 Pronunciation judging (approximate)

```
 expected text ─┐
                ├─► Qwen3-ASR  ────►  hypothesis text ─┐
 recorded audio ┘                                     ├─► features
                ├─► ForcedAligner(expected) ─► timings┘
                                                        │
                    ┌───────────────────────────────────▼───────────────────┐
                    │ OpenRouter "judge" (JSON schema out)                  │
                    │ in: expected, hypothesis, per-word timings, language  │
                    │ out: { score 0..100, words:[{w,ok,tip}], summary }    │
                    └──────────────────────────────────────────────────────┘
```

Features we compute deterministically (cheap, explainable):

- **Text similarity:** normalized edit distance / CER against the expected text.
- **Coverage:** which expected words are missing/extra.
- **Timing anomalies:** per-word duration vs expected syllables (too fast/slow),
  long pauses (hesitation), truncation.
- **Speech rate** (syllables/sec) vs target.

Then the LLM judge turns those numbers into a 0–100 score and _human feedback_.

> **Limitation (call out in UI):** this is **word-level**, not phoneme-level GOP
> scoring. Real tone/pronunciation precision (esp. Mandarin tones) needs a phoneme
> acoustic model (e.g. a wav2vec2 phoneme CTC head) or a TTS round-trip. Planned
> as Phase-8 "precision mode"; MVP is "understood + roughly correct + timing".

---

## 10. LLM subsystem — OpenRouter

### 10.1 Roles (user-selectable, swappable)

```
roles = {
  conversation: "…",   // live chat / roleplay tutor
  judge:        "…",   // grades free-form answers + pronunciation
  generator:    "…",   // creates cards & exercise variants
  translator:   "…",   // quick word/phrase lookups
}
```

This mirrors `~/.config/opencode/opencode.json` `model` / `small_model`: a map from
role → OpenRouter model id, **editable by the user in the app**.

**User picks the model, the app ships defaults.** The Settings screen lets the user
choose a model per role from OpenRouter's live catalogue, using whatever key they
have set: `GET /api/v1/models/user` (filtered by that key's provider
preferences, privacy settings and guardrails) when a key is present, falling back
to the public `GET /api/v1/models` otherwise. Defaults on first run (all OpenRouter
ids, so swapping is one click):

- `conversation` + `judge` → a strong general model (e.g. a Qwen3 flagship).
- `generator` + `translator` → a cheap/fast model.

Because roles are just ids, a user whose key is provisioned for **DeepSeek**,
**OpenAI**, **Anthropic**, **Gemini**, etc. can point every role there without any
code change. We persist the per-role choice in `settings`, validate that the key
can list the chosen model, and fall back to a default on error. Expose a
per-role "test" button and show cost/latency so switching is informed.

### 10.2 Integration

- `POST /api/v1/chat/completions` with `stream: true` → SSE relayed to the UI.
- **Structured outputs** (`response_format: json_schema`) for grading and card
  generation; validate with zod, retry once on schema failure.
- **Tool calling** for "the tutor decides to present a card / start a drill".
- Record token usage + cost per message; surface in a dev panel.

### 10.3 Prompt architecture

- System prompt = tutor persona + target language + learner level + **allowed
  CEFR band** + correction policy (correct gently, don't switch to English).
- Exercise prompts are assembled by the **exercise engine** (§11) from the card +
  type, never hard-coded in the UI.
- Keep prompts lean to control cost; cache stable prefixes where the provider
  supports it.

---

## 11. Core domain: cards & the exercise engine (extensibility heart)

### 11.1 Cards

A `Card` is a discriminated union with a JSON payload so **new card types never
require a migration**:

```ts
type Card = {
  id: string
  type: 'vocab' | 'phrase' | 'grammar' | 'kanji' | 'character'
  sourceLang: string // e.g. 'zh', 'ja', 'en'
  targetLang: string
  front: string // native side
  back: string // target side
  readings?: Record<string, string> // pinyin / romaji / kana
  tags: string[]
  payload: Record<string, unknown> // type-specific extras (zod-validated)
  metadata: Record<string, unknown> // language-specific annotations (see below)
  origin: 'curated' | 'llm' | 'manual'
  createdAt: number
}
```

**Metadata** is the language-agnostic escape hatch for annotations that don't
fit the role-named content above — the things that are specific to one language
or one deck: Japanese pitch accent, tone contours, radicals, mnemonics. Keys are
plain names and a value is `unknown`, so a new annotation kind never needs a
schema change. One shape is built in because the app renders it:

```ts
metadata.pitch = {
  levels: ['L', 'H', 'H', 'L'], // one level per mora
  syllables: ['か', 'み', 'さ', 'ま'],
  drop: 3, // accent nucleus counted from 1; 0 = heiban (no in-word drop)
}
```

The container names no language: a pitch contour is the *shape* of the pitch, so
Japanese pitch accent (高低アクセント) and a Mandarin tone contour read the same
way. Metadata never affects grading — `readings` and `back` stay the source of
truth for correctness. A deck asks the generator for it (`pitchAccent`), and a
card's bag is editable per-card via `PATCH /api/decks/:id/cards/:cardId`
(merged by key; `null` removes one).

A deck's own rules — including `pitchAccent` — are edited from the deck's
**settings** sheet on Learn (`DeckSettings.svelte`), which also owns deck
deletion. Because `pitchAccent` only reaches *new* batches, the sheet can
**backfill** the cards a deck already has: `POST /api/decks/:id/pitch` annotates
every card that lacks a contour (keeping the rest) and returns how many it
annotated. `deck/pitch.ts` holds the annotator and the shared backfill, so the
route and `scripts/backfill-pitch.ts` do the same work.

Pitch is **looked up, not invented**: `deck/kanjium.ts` resolves the accent
number from the bundled **Kanjium** dictionary (`kanjium-accents.txt`, CC BY-SA
4.0, https://github.com/mifunetoshiro/kanjium) and derives the levels and the mora
split here, so a contour always agrees with its accent number. A language model
guesses Tokyo accent badly (毎日 comes back heiban instead of 頭高), so the
generator is asked only for words the dictionary does not know, and the deck
builder overrides the model's contour with the dictionary when a Japanese deck
asks for pitch. The settings sheet's **Re-annotate from dictionary** button
(`{ force: true }`) rewrites the contours a deck already has from the dictionary
alone — no key, no model.

Chinese readings are looked up the same way. `deck/mandarin.ts` resolves a word's
**Zhuyin** from `mandarin-readings.txt`, built by
`scripts/build-mandarin-readings.py` from the Ministry of Education's
《重編國語辭典修訂本》 (Taiwan; CC BY-ND 3.0 TW, readings used verbatim) and
**McBopomofo** (https://github.com/openvanilla/McBopomofo, MIT; each character's
preferred reading and the words the ministry dictionary omits). The deck builder
overrides the generator's reading for a `zh` deck, except where the word came
with its own reading (an Anki import) — that is the source deck's authority.
Only Traditional characters have entries: Zhuyin is a Taiwan script, so a
Simplified or pinyin deck keeps the generator's reading.

Cards come from: a curated starter deck, LLM generation ("give me 20 HSK-1
food words"), or manual entry.

### 11.2 Exercise definitions (the plugin contract)

```ts
interface ExerciseDef<Ctx = unknown, Inst = unknown, Res = unknown> {
  id: string // e.g. "translate.front_to_back"
  title: string
  modality: 'chat' | 'voice' | 'text' | 'mixed'
  supports(card: Card, learner: Learner): boolean
  generate(ctx: Ctx): Promise<Inst> // may call OpenRouter (can be cheap/none)
  grade(ctx: Ctx, answer: unknown): Promise<Res> // rules and/or OpenRouter judge
  xp(res: Res, inst: Inst): number // XP formula lives with the exercise
}
```

- Registered in `packages/core/registry.ts`.
- Backend resolves `id → generate/grade`; **frontend maps `id → Svelte component`**.
- Adding an exercise = one file in each place + a registry line. Nothing in the
  core needs editing → this is _the_ extensibility promise.

### 11.3 Built-in exercise kinds (roadmap)

| id                        | modality   | MVP   | Grading                      |
| ------------------------- | ---------- | ----- | ---------------------------- |
| `translate.front_to_back` | text       | ✅    | exact / fuzzy + LLM judge    |
| `translate.back_to_front` | text       | ✅    | exact / fuzzy + LLM judge    |
| `type_listen`             | text       | ✅    | ASR-free: TTS plays, type    |
| `speak_word`              | voice      | ✅    | ASR + aligner + judge (§9.4) |
| `converse`                | chat/voice | ✅    | LLM judge on the turn        |
| `multiple_choice`         | text       | ✅    | exact                        |
| `sentence_build`          | text       | ✅    | token order (n+1 vocabulary) |
| `fill_blank` / `roleplay` | mixed      | later | judge                        |

### 11.4 Game systems plug in via an event bus

The engine emits domain events; game systems subscribe, so new mechanics don't
touch the core:

```ts
events.emit('review.completed', { cardId, exerciseId, score, ms })
events.emit('xp.awarded', { amount, reason, sourceId })
events.emit('streak.updated', { days })
```

---

## 12. Data model (SQLite)

```
users(id, username UNIQUE, password_hash, handle, role /*admin|user*/,
      native_lang, target_lang, level, settings_json, created_at, updated_at)
auth_sessions(id /*sha256(token)*/, user_id, created_at, expires_at, user_agent)
user_settings(user_id, key, value, PRIMARY KEY(user_id,key))
decks(id, user_id, name, source_lang, target_lang, level, description)
cards(id, deck_id, user_id, type, source_lang, target_lang, front, back,
      readings_json, tags_json, payload_json, metadata_json, origin, created_at)
reviews(id, card_id, user_id, exercise_id, score, latency_ms, detail_json,
        audio_ref, created_at)                 -- one row per attempt
sessions(id, user_id, deck_id, kind /*chat|voice|mixed*/, lang,
         title, started_at, ended_at)
messages(id, session_id, role, text, audio_ref, model, tokens_in, tokens_out,
         cost_usd, created_at)                 -- PERMANENT history
attempts(id, session_id, card_id, user_id, exercise_id, answer_json,
         grade_json, score, created_at)
xp_events(id, user_id, amount, reason, source_id, created_at)  -- append-only
stats(user_id, xp_total, level, streak_days, last_active_day, daily_goal,
      updated_at)                              -- cached/derived
settings(key, value)                           -- server-global (registration, etc.)
audio_blobs(hash, user_id, path, bytes, mime, seconds, created_at)  -- files on disk
```

Notes:

- **History is append-only** for `messages`, `reviews`, `attempts`, `xp_events`.
  XP total = `SUM(xp_events.amount)`; `stats` is a cache we can rebuild.
- **Audio** is stored as files under `$TUTOR_DATA_DIR/audio/<sha1>.wav`, referenced
  by hash — keeps the DB small and lets us prune old audio independently.
- Migrations are hand-written `.sql` files in `apps/server/migrations`, applied in
  order and tracked in `_migrations`.

## 12.5 Multi-user & authentication

Several people share one server (the Mac), each with **their own account, history,
settings and OpenRouter key**.

- **Accounts:** local username + password. Passwords hashed with **argon2id**
  (Bun's built-in). The **first account is the admin**; the admin can list/remove
  users. Registration can be closed with `TUTOR_ALLOW_REGISTRATION=false` once
  everyone has signed up.
- **Login sessions:** opaque random token in an httpOnly cookie; only its
  **SHA-256 hash** is stored in `auth_sessions`, with a 30-day sliding expiry.
  Cookie is `Secure` automatically when served over HTTPS.
- **Isolation:** every request resolves the session to a user and **all** queries
  are scoped by `user_id` — a user can only ever read/write their own rows.
  `/api/chat`, `/api/sessions`, `/api/settings` etc. return `401` without a
  session; there is no cross-user read path.
- **Per-user keys:** each user stores their own OpenRouter key in `user_settings`
  (encrypted at rest when `TUTOR_SECRET` is set, otherwise marked `plain:`). If a
  user has no key, the server-level `OPENROUTER_API_KEY` is used as a fallback.
  This is what makes "use Qwen, or point it at DeepSeek" a per-user choice.
- **The speech gateway is shared** — it's one piece of hardware (the Mac's GPU).
  Idle shutdown is a server-level concern, not per-user. Speech *settings*
  (voice, mode) are per-user.

Public endpoints (no session): `GET /api/health`, `GET /api/models`,
`POST /api/auth/{register,login,logout}`, `GET /api/auth/me`.

---

## 13. Gamification (skeleton now, game later)

- **XP ledger** (append-only) + **level curve** (e.g. `level = f(xp)`), shown in a HUD.
- **Streak**: one "active day" per **UTC calendar day** with ≥1 completed exercise.
- **Daily goal**: configurable XP target with a progress ring.
- **Combo / accuracy bonus**: small multipliers; formula lives with the exercise.
- **Achievements**: table + triggers on events (later).
- Everything routes through the **event bus** so "more game" is additive:
  quests, leagues, leaderboards, cosmetics — all new subscribers.

XP examples: correct translation +10, spoken word ≥80 score +15, full
conversation turn +5, perfect streak bonus +25.

## 13.5 Professions & talents (the game layer)

The game is a **RuneScape/WoW-style profession system** layered on top of the
language drills. It is *not* an idle game: you pick a profession action, the app
gives you "the next drill", and a correct answer awards that action's XP and
materials.

**Actions are exercise-agnostic.** A profession action defines its tier, its own
XP pool, materials and unlock/equipment requirements — but not the exercise type.
The trainer picks the eligible drill you have practised *least recently*
(`pickNextExercise`), so you always get variety instead of the same question type.
The action — `Mine copper` — is also the unit that **levels up**; see below.

**22 professions** in four groups:

| Group | Professions |
| --- | --- |
| Gathering | Mining, Woodcutting, Fishing, Farming |
| Artisan | Smithing, Cooking, Herblore, Fletching, Runecrafting, Crafting, Firemaking, Construction |
| Support | Thieving, Agility |
| Combat | Attack, Strength, Defence, Constitution, Ranged, Magic, Prayer, Slayer |

**Materials & chains** (42 items) — gathering produces raw goods, artisans refine
them, combat consumes gear:

```
Mining ──ores/essence──► Smithing ──bars──► weapons & armour ──► Attack/Strength
  └────► Runecrafting ──runes──► Magic
Woodcutting ──logs─┬─► Fletching ──bows + arrows──► Ranged
                   ├─► Firemaking ──ash──► Herblore
                   └─► Construction ──planks──► furniture
Fishing ──fish──► Cooking ──food──► combat
Farming ──herbs──► Herblore ──potions──► combat
Thieving ──gems──► Crafting ──vials──► Herblore ; ──leather──► armour
Slayer ──bones──► Prayer ; combat drops ──hides/bones/gems──► Crafting/Prayer
```

**The level lives on the action, not the profession.** Every action has its own
XP pool and its own level, and its own passive that grows with *that* action:
gathering +1% **of the action's own output**/level (`Mine copper` gives more
copper, `Mine essence` more essence — not more of everything), artisans +0.5%
bonus-product chance/level, Agility +0.5% **XP to every profession**/level, combat
+1% power/level, Slayer +1% rare drops/level, Thieving +2% coins/level.

**The curve is gentle by design.** One action level costs `10 + (level − 1)` XP,
so maxing a single action is ≈5.8k XP and a 4-action profession ≈23k. Level 100 is
a long goal, not an impossible one.

**The profession level is derived — the mean of its actions, out of 100.** A
profession has no XP of its own, and every action is capped at level 100, so a
profession's level is `round(mean(action levels))`:

```
Mining  Lv 2          ← "overall skill", always out of 100
├─ Mine copper   Lv 4   → +4% copper per action level
├─ Mine essence  Lv 2   → +2% essence
├─ Mine iron     Lv 1
└─ Mine coal     Lv 1
```

Everything that used to read a profession level now reads this mean: unlock
requirements (`Needs Mining 5`), the combat power formula, and the talent
milestones. A fresh profession is level 1 **however many actions it has**.

**Adding content lowers the level, by design.** Because the profession is a mean,
shipping a new action (mythril ore, a new fish) adds a fresh level-1 component to
the denominator: a maxed 4-action Mining drops from 100 to 80 until the new action
is trained. Levels stay comparable as the game grows — `100` always means
"everything in this profession is maxed", and the skills board's total is the
mean of the professions so it also reads out of 100.

**Talents** are still per profession, taken at milestones of the derived level:
- **Every 10 levels** (10, 20, 30, …) → choose **one of two** talents:
  *Prospector* (+15% yield on every action of the profession; combat professions
  instead get *Keen strikes*, +15% power) or *Studious* (+5% XP to every
  profession). A choice can be changed later at the same milestone (a free respec).

Talent ids encode skill + milestone, so progression continues indefinitely.
All effects aggregate through `computeBonuses(actionLevels, talents)`.

**Equipment & combat:** Smithing forges weapons/armour, Fletching makes bows,
arrows and staffs, Crafting makes leather armour. A fight uses **whatever you have
equipped** — you never pick a weapon or a skill. The equipped weapon's tag decides
the combat profession the fight trains: a melee weapon (sword) trains **Strength**,
a bow trains **Ranged**, a staff trains **Magic**, and bare hands are still melee
(Strength). `actionState()` reports `locked / affordable / equipOk` for every
profession-board action (those still gate on gear).

**Fights (active, language-driven):** 6 monsters with HP, damage and drop tables.
Any monster can be fought with any gear — difficulty is its HP and damage, not a
gate. Combat drills are **review only**: a fight never introduces a new card, it
drills cards that already have a spaced-repetition state (due ones first). Drills
run as a **time attack**: the first drill waits for a Start click, then each drill
gets 20 seconds and the next drill's clock starts as soon as the previous exchange
resolves. A timeout counts as a miss. **The monster lands a blow on every
exchange** — whether you strike it, miss, or run out of time — for
`monster.damage − armour` (min 1), and that damage trains **Defence and
Constitution**. A drill you answer **correctly** also lands your own hit for
`playerPower = (3 + skillLevel*1.5 + weaponPower) * (1 + damageBonus)` (`skillLevel`
is the spawned profession's **derived** level, the one your weapon trains). Your HP
is `20 + constitution*4 + hpBonus*20 + armour*2` and **carries between fights**;
**only food and potions heal it** — there is no passive regeneration, and a defeat
leaves you at 1 HP rather than a free heal. **Win** → drops (with the Slayer
bonus) + combat XP (credited to the trained profession) + overall XP;
**lose** → the fight ends with nothing. One active encounter per player
(`encounters` table). Events: `combat.hit`, `combat.ended`.

**Auto-consumables:** food (`cooked_shrimp`/`trout`/`lobster` heal 4/8/14) and
potions (`attack_potion` +25% power, `restore_potion` +25% max HP). A potion is
**auto-drunk at the start of a fight**; the best food in your bank is **auto-eaten
whenever HP drops below the threshold** (default 50%, a per-user setting). Monsters
are balanced around you bringing food — without it the harder fights are a straight
race you'll lose. Grading an action also validates unlock + affordability, so
material costs can't be bypassed by calling the grader directly.

Everything still flows through the **event bus**: `skill.xp`, `skill.level.up`,
`item.gained`, `item.consumed`, `talent.chosen`, `talent.changed`, `item.equipped`.

## 13.6 Spaced repetition (FSRS-6, Anki-style) & guided curriculum

Scheduling uses **FSRS-6** — the algorithm Anki 25.07+ uses — through the
reference TypeScript implementation (`ts-fsrs`, FSRS-6 model) with Anki's
**default 21 weights** (`w20 = 0.1542` trainable decay), Anki's default
**learning steps** (`1m`, `10m`) and **relearning steps** (`10m`), and intervals
derived from a **desired retention** (default `0.9`, per-user). The state machine
around the memory math — steps, due dates, card selection, curriculum graduation
— is ours (`apps/server/src/game/srs.ts`).

```
   rating  ──┐
  (Again/Hard/Good/Easy)        memory state (per card, per user)
             │        ┌────────────────────────────────────────────┐
   ┌─────────▼──────┐ │  state: new→learning→review↔relearning     │
   │   FSRS-6 core  │ │  stability S, difficulty D, step, reps,    │
   │  schedule()    │ │  lapses, intervalDays, dueAt, lastRating   │
   └─────────┬──────┘ └────────────────────────────────────────────┘
             │
   dueAt + intervalDays ──► selectCardId() (overdue → new → soonest)
```

- **Ratings come from the exercise score**: `!correct → Again`, `≥90 → Easy`,
  `≥80 → Good`, else `Hard`. Every review (practice *and* combat hits) feeds the
  scheduler, and the API returns the decision so the UI can show
  *“Good · next in 6 days · stability 38.9d · difficulty 2.1”*.
- **Review log**: every review that moves a schedule — practice *and* combat —
  appends to `srs_reviews` with the FSRS rating, fractional elapsed days, the
  before/after memory state, the desired retention in force and the source. That
  is the history a future model (FSRS-7) or a per-user weight optimizer would
  replay; it is append-only and independent of the current scheduler.
- **Retrievability** uses the power-law curve `R = (1 + factor·t/S)^−w20` with
  `factor = 0.9^(−1/w20) − 1`, so `R(t = S) = 0.9`. Intervals solve that curve for
  the desired retention.
- **Curriculum**: each deck is split into themed **8-card lessons** that unlock in
  order; a lesson completes once every card is *learned* (graduated to `review`
  with a ≥1-day interval). Events: `srs.updated`, `lesson.completed`.

## 13.7 The frequency path & n+1 sentences

The flagship path is built **dynamically off a frequency list**, not hand-written
lessons. `seed/frequency.ts` (Mandarin) and `seed/frequency-ja.ts` (Japanese) hold
frequency-ordered lists tagged with a part of speech; the deck is seeded in that
order and the curriculum walks it **one word per step**, so a step can only ever
introduce a single new thing:

```
我 → 你 → 是 → 不 → 好 → 很 → …                (frequency order)
   step 1   step 2  step 3   …                 each step = 1 new word
```

The Learn tab is deliberately minimal: pick a course, tap **Next**. The lesson list
is gone — the path advances one step at a time.

**n+1, enforced by construction.** The `sentence_build` exercise generates a short
sentence that uses the new word *exactly once* and every other word from the set the
learner has already learned (`knownWords`, computed from the SRS state). This is a
small hand-written pattern grammar (`game/grammar.ts`), not an LLM call, so it is
instant, deterministic and works with no API key:

```
new word: 喝        known: 我, 茶        →  我 喝 茶   ("I drink tea")
new word: 很        known: 我, 好        →  我 很 好   ("I am very good")
new word: 茶        known: 我, 有        →  我 有 茶   ("I have tea")
```

Patterns contribute function words as they are learned (是, 很, 不, 在, 吗, 也, 的,
和 …), a small semantic layer keeps objects sensible (喝 takes 水/茶, 吃 takes food),
and an exercise is only offered once a sentence can actually be built. The learner
builds the sentence by tapping word tiles in order **or** typing it.

Every course is the frequency path: the same builder emits one-word steps for
both Mandarin (`zhfreq`) and Japanese (`jafreq`).

**Readings are native scripts only.** Every card stores the phonetic script, never a
Latin transliteration — the UI shows:

- Chinese → **Traditional characters** with **Zhuyin** (bopomofo) below, derived from
  pinyin by a mechanical converter (`seed/zhuyin.ts`), e.g. 學生 = ㄒㄩㄝˊ ˙ㄕㄥ.
- Japanese → **furigana**, i.e. the kana split into ruby segments over the kanji
  (`seed/furigana.ts`): 食べる → 食[た]べる, お茶 → お茶[ちゃ].

No pinyin or romaji is stored or shown; the Latin source is used only to derive the
native reading at seed time. Grading accepts the characters or the native reading.
The rule is enforced everywhere text is generated too: every LLM call (chat, judge,
deck generator) is told to write **Traditional characters only** and readings in
**Zhuyin only** (`MANDARIN_RULE` in `llm/prompts.ts`), and the deck generator is
required to return Traditional `back` values.

**Teach before you test.** The first time a learner meets a card, the practice route
serves the `introduce` exercise instead of a drill: it shows the word, its native
reading and its meaning, plus a short **n+1 example sentence built only from words
the learner has already met** (the new word plus prior vocabulary — never an unseen
word), and a **Got it** button. That step
records the introduction (a review row tagged `introduce`) but carries **no SRS
state and no XP** — there was nothing to recall yet. The next time the card comes up
it is a normal graded drill. `pickNextExercise` filters `introduce` out of the
rotation, so it only ever appears as this first-exposure prelude.

## 13.8 Study preferences (per user)

Decks are shared content; how you *drill* them is personal. `game/study.ts` keeps
a small bag of per-user knobs in `user_settings` (no migration needed), editable
in **Settings › Study** and applied everywhere practice is served (the practice
routes and the combat drill both read them):

- **Readings** — `showZhuyin` (Chinese) and `showFurigana` (Japanese). Turning one
  off hides native readings from prompts, choice options and feedback, making the
  card harder. Grading still accepts the reading as a correct answer.
- **Exercise kinds** — `disabledExercises`, a list of exercise ids the learner
  turned off (e.g. every `voice` kind, to skip speaking and listening). Disabled
  kinds are filtered out of the drill rotation and swapped for an allowed one even
  when a caller forces them. The first-exposure `introduce` step is never a drill
  and cannot be disabled.

Preferences are per account, so two people on the same server can study the same
decks with different scripts and exercise sets.

---

## 14. Web UI / UX — SvelteKit PWA, mobile-first

Primary target is **Android**, used one-handed on a phone. The UI is designed
phone-first and scales up to tablet/desktop.

- **SvelteKit** with `adapter-static` in SPA mode → a static shell the Bun server
  serves and the service worker caches. All dynamic data goes through the Hono API.
- **PWA**: web manifest, installable to the Android home screen, offline app shell
  (the history/settings screens render offline; speech needs the Mac anyway).
- **Mobile-first** layout: bottom tab bar, thumb-reachable primary actions, big
  record button, dark theme, safe-area insets, no hover-only affordances.
- **Streaming**: token-by-token text via SSE; TTS starts per sentence so the tutor
  "starts talking" while still typing.

Screens (MVP):

1. **Home / HUD** — streak, XP, daily goal ring, "Continue" (next card).
2. **Practice** — renders the current exercise by `modality`:
   - text/chat exercise → prompt + input + inline feedback
   - voice exercise → big record button, waveform, playback of the tutor, score
3. **Conversation** — full chat/voice with the tutor; TTS plays replies; mic
   toggle; correction highlights.
4. **History** — browse past sessions and messages (permanent), replay audio.
5. **Settings** — languages, **voices**, **per-role model picker** (§10.1), speech
   idle timeout, "Free memory now", OpenRouter key status.

Interaction details:

- **AudioContext must be unlocked by a user gesture** → start on first play/record click.
- Show a **"waking up the tutor"** state while the sidecar cold-starts (§8.4).
- Streamed text appears token-by-token; TTS starts per sentence.

### 14.1 Secure context — microphones on Android need HTTPS ⚠️

`getUserMedia` (the mic) only works in a **secure context**. If the phone loads the
app from the Mac over the LAN as `http://192.168.x.x:3000`, **the mic is blocked**
and Android shows a confusing permission failure. Options, in order of preference:

1. **Local HTTPS with a trusted cert (recommended).** Generate a cert with
   `mkcert` for the Mac's LAN hostname/IP, serve SvelteKit + API over HTTPS, and
   install the mkcert root CA on the phone once. Works offline, no third party.
2. **Tunnel** (e.g. Cloudflare quick tunnel) → a public `https://…` URL. Good for
   quick testing or when away from home; needs internet and exposes the app.
3. **`adb reverse tcp:3000 tcp:3000`** over USB → the phone sees `localhost:3000`,
   which _is_ a secure context. Great for development, useless for daily use.

**Decision:** ship option 1 (mkcert + HTTPS) as the default, document the rest.
The Bun server should support an optional `--tls-cert/--tls-key`. This also lets us
register a service worker for the PWA, which otherwise also requires HTTPS.

### 14.2 Language hints — keyboards & IMEs (best effort, not a switch)

A page **cannot** switch the OS keyboard / input method. There is no such API on
any platform (Android, iOS, macOS, Windows): the layout is the user's, and on the
desktop it is OS-driven (Ctrl+Space / Cmd+Space). `inputmode` only picks the
keyboard *type* (text / numeric / tel / …), never the language. So the tutor does
not try to *bring up* the Japanese IME — it gives the platform the best hints it
will accept (`apps/web/src/lib/lang.ts`):

- **`answerLang` on every typing exercise.** The backend names the language the
  learner types with (`card.targetLang`, or `card.sourceLang` for
  `translate.back_to_front`, whose answer is in the learner's own language). The
  client spreads `typingAttrs(answerLang)` onto the field: `lang` (the real hint —
  some Android keyboards read it; it also feeds spellcheck and font fallback),
  `inputmode="text"`, `enterkeyhint`, plus `spellcheck/autocorrect/autocapitalize`
  off so an English dictionary doesn't red-squiggle every kana.
- **Element-level `lang` on target-language content.** `Word.svelte` tags the word
  it renders, so the browser shapes and announces the right script.
- **`<html lang>` follows the learner's native language** (the language prompts,
  meanings and feedback are written in), updated per account — not the target
  language, which would mis-announce the mostly-English chrome to a screen reader.

Where this does not help, the **word-tile / character-bank** interaction
(`sentence_build`, `multiple_choice`) sidesteps typing entirely — the reliable
path on mobile for a beginner who has not enabled a CJK keyboard. A built-in
romaji→kana / pinyin→hanzi IME would make *free* typing work cross-platform, and
remains future work.

---

## 15. Nix flake design (dev + packaging)

### 15.1 Principles

- Flake provides **tools + the app build**; Python venv and models stay **on disk**
  (Metal can't run in the sandbox; weights are multi-GB and must be mutable/cached).
- One `nix develop` → everything for dev. One `nix run` → run the app locally.

### 15.2 Sketch

```nix
{
  description = "tutor — AI language learning (MLX speech + OpenRouter brain)";
  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };
  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachSystem [ "aarch64-darwin" ] (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        py   = pkgs.python312;
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun nodejs_24 uv py ffmpeg git cacert just sqlite pkg-config
            mkcert        # local HTTPS for Android mic (see §14.1)
          ];
          shellHook = ''
            export TUTOR_DATA_DIR="''${TUTOR_DATA_DIR:-$PWD/data}"
            export TUTOR_MODELS_DIR="''${TUTOR_MODELS_DIR:-$PWD/models}"
            export HF_HOME="$TUTOR_MODELS_DIR"
            export UV_PYTHON="${py}/bin/python3.12"
            echo "tutor dev shell — run: just setup && just dev"
          '';
        };

        # App artifact: web assets + compiled Bun binary
        packages.default = pkgs.callPackage ./nix/package.nix { inherit py; };
        packages.speech  = pkgs.callPackage ./nix/speech.nix  { inherit py; };

        apps.default    = { type = "app"; program = "${self.packages.${system}.default}/bin/tutor"; };
        apps.fetch-models = { type = "app"; program = "${self.packages.${system}.speech}/bin/tutor-fetch-models"; };

        formatter = pkgs.nixpkgs-fmt;                 # or alejandra
        checks.default = pkgs.runCommand "tutor-checks" {} "echo ok";
      });
}
```

### 15.3 Packaging details

- **JS deps**: a fixed-output derivation runs `bun install --frozen-lockfile` over
  the flake source and returns the repo with `node_modules` baked in (hash pinned
  in `nix/package.nix`).
- **Web**: `bun scripts/gen-migrations.mjs` then `bun run --cwd apps/web build`
  (SvelteKit `adapter-static`) → static PWA assets.
- **Server**: `bun build --compile --minify apps/server/src/index.ts` → a single
  ~85 MB binary (no node at runtime). Migrations are **embedded**
  (`migrations.gen.ts`) so the binary needs no source tree.
- `packages.default` = a `writeShellApplication` `tutor` that sets `TUTOR_DATA_DIR`
  (`~/.local/share/tutor`), `TUTOR_MODELS_DIR`, `HF_HOME` and `TUTOR_STATIC_DIR`
  (the store's built PWA); copies the Python project out of the read-only store
  into the data dir on first run and `uv sync`s the venv there; then execs the
  compiled binary.
- **Python sidecar** is _not_ baked into the store as wheels (Metal/venv). Instead
  `nix/speech.nix` ships:
  - a `tutor-fetch-models` script (uses `hf` CLI + `uv`) that downloads the pinned
    MLX models into `$TUTOR_MODELS_DIR`, and
  - a wrapper that runs `uv sync` in `python/` on first use then launches the sidecar.
    Alternatively ship a prebuilt venv under `$TUTOR_DATA_DIR/.venv` created by
    `just setup`.
- **`justfile` targets**: `setup`, `dev`, `dev-web`, `models`, `gen`, `build`,
  `package`, `run`, `certs`, `bench`, `test`, `check`.

**Verified:** `nix build .#default` produces the binary + assets, and running it
serves the PWA, applies the embedded migrations, registers a user, and spawns the
speech sidecar (TTS returned a WAV) — all with the venv and weights outside the
store.

### 15.4 Hosting on the Mac (nix-darwin + Tailscale)

The Mac is a nix-darwin host, so hosting is declared, not scripted:

- **`darwinModules.default`** (import `inputs.tutor.darwinModules.default`) adds a
  `launchd.user.agents.tutor` agent (runs as you, so it has your `$HOME` where the
  MLX venv and weights live) and, optionally, HTTPS:
  - `services.tutor.tailscaleServe.enable` → a `tailscale serve --https=443`
    agent (Tailscale issues a real cert for `*.ts.net`; no extra software), or
  - `services.tutor.caddy.enable` + `hostname` → a `tailscale cert` agent plus a
    `caddy run` agent using a generated Caddyfile.
- Options: `enable`, `package`, `host`, `port`, `dataDir`, `modelsDir`,
  `environmentFile`, `tailscaleServe.{enable,httpsPort}`, `caddy.{enable,hostname}`.
- Non-nix-darwin fallback: the same shape is available as `just service-install`
  (a launchd agent via `deploy/launchd.plist.template`) + `just tailscale-serve`.

The app binds `127.0.0.1` and trusts `X-Forwarded-Proto: https`, so cookies are
`Secure` behind either proxy. `tailscale serve` routes are per-path, so it coexists
with anything else already served on the machine.

> Tradeoff documented: fully hermetic packaging of MLX is not worth it here.
> We pin `bun.lock`, `uv.lock` and model revisions instead, which gives
> reproducibility in practice while letting Metal and multi-GB weights live where
> they must.

---

## 16. Config, secrets, data dirs

```
$TUTOR_DATA_DIR/           (default: ./data in dev, ~/.local/share/tutor packaged)
  tutor.db                 SQLite
  audio/<sha1>.wav         permanent audio history
  .venv/                   uv-managed Python env (speech)
$TUTOR_MODELS_DIR/         (default: ./models)  HF/MLX model cache
~/.config/tutor/env        OPENROUTER_API_KEY, TUTOR_* (chmod 600)
$TUTOR_DATA_DIR/tls/       mkcert cert+key for HTTPS on the LAN (§14.1)
```

- Secrets never in the DB or the store. Load `.env`/`env` at startup; never log keys.
- Bind to `127.0.0.1` only. Single local user by default; schema is multi-user ready.
- Model revisions pinned (commit hash / tag) in `python/uv.lock` + a `models.json`.

---

## 17. Observability

- Structured logs (JSON) with request IDs.
- Per-message token + `cost_usd` from OpenRouter usage; a dev "spend" panel.
- Speech metrics: cold-start ms, ASR latency, TTS first-packet ms, resident RSS,
  unload events (so we can tune the idle timeout).
- `just bench` script to print ASR latency, TTS RTF and peak RAM on this Mac.

---

## 18. Risks & mitigations

| #   | Risk                                               | Mitigation                                                                       |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Nix sandbox can't do Metal / no `mlx` in nixpkgs   | Python venv + models live on disk; flake ships tools/wrappers                    |
| 2   | macOS 27 / M6 too new for MLX wheels               | Pin `uv.lock`; verify in Phase 1 before building UI; fallback to CPU/whisper.cpp |
| 3   | 16 GB pressure with browser + models               | 8-bit/6-bit models; idle unload (§8); memory-pressure trigger                    |
| 4   | Cold-start latency hurts UX                        | Pre-warm on voice mode entry; "waking up" UI; keep warm mid-convo                |
| 5   | Streaming TTS chunking + AudioContext policy       | Sentence-level chunking; unlock AudioContext on first gesture                    |
| 6   | Pronunciation scoring is word-level, not phoneme   | Ship "understood + timing" MVP; label it clearly; Phase-8 GOP mode               |
| 7   | OpenRouter cost / rate limits                      | Cheap models for bulk, strong for convo; cache stable prefixes; usage tracking   |
| 8   | `mlx-audio` server model residency (one at a time) | Use **our** sidecar (load ASR+aligner+TTS, LRU evict) not stock server for prod  |
| 9   | Audio history grows unbounded                      | Content-hash dedupe; retention/prune policy in settings                          |
| 10  | Monorepo build complexity under Nix                | `bun build --compile` single artifact; minimal store-time Python                 |

---

## 19. Execution roadmap

Phases are sequential; each has acceptance criteria. **Phase 1 de-risks the model
stack before any UI work.**

### Phase 0 — Bootstrap (½–1 day)

- `git init`; create monorepo layout (§6); `flake.nix` + `flake.lock`;
  `justfile`; `README.md`; prettier + svelte-check; `checks` in the flake.
- **Acceptance:** `nix develop` gives bun/uv/ffmpeg/python; `just --list` works.

### Phase 1 — Speech gateway on this Mac (1–2 days) ⭐ de-risk first

- `python/pyproject.toml` (uv) with `mlx-audio`, `mlx`, `soundfile`, `fastapi`.
- `python/speech/server.py`: load ASR-1.7B + ForcedAligner + TTS-1.7B; endpoints
  `/v1/asr`, `/v1/align`, `/v1/tts`, `/health`, `/admin/unload`; idle unload.
- Fetch models via `hf` into `$TUTOR_MODELS_DIR`.
- **Acceptance:** round-trip — speak Mandarin → ASR text; TTS speaks it back;
  aligner returns word timings; peak RSS < 8 GB; process exits on idle and
  RAM returns; measure cold-start + latency.

### Phase 2 — Backend skeleton (1–2 days)

- Bun + Hono server; Drizzle + SQLite schema/migrations (§12); serves the PWA
  static shell; optional `--tls-cert/--tls-key` for the Android secure context
  (§14.1).
- OpenRouter client (stream + JSON schema + usage) + **model catalogue proxy**
  (`GET /models`, filtered) and per-role model selection persisted in `settings`.
- SSE endpoint; config loader; speech supervisor (lazy start / idle stop / health).
- **Acceptance:** streamed chat reply over SSE; messages persist; user can switch
  the per-role model and see it take effect; supervisor starts/stops the sidecar
  on demand; unit tests on graders.

### Phase 3 — Web MVP: SvelteKit PWA, multi-user auth + chat/voice (3–4 days)

- **Multi-user backend** (done first, so the UI is auth-aware): accounts, argon2id
  passwords, cookie sessions, per-user isolation + settings + OpenRouter keys.
- SvelteKit + Tailwind, `adapter-static` SPA, PWA manifest + service worker;
  sign-in/sign-up screens; mobile-first Home HUD + Conversation screen; mic
  record → ASR; reply → streaming TTS playback; History viewer; Settings
  (per-role model picker, voice, own key, free memory); HTTPS cert setup.
- **Acceptance:** two accounts hold separate conversations and never see each
  other's history; install the PWA on an Android phone; hold a typed and a spoken
  conversation over HTTPS; reload → history intact; TTS audio plays; no orphan
  Python process after idle.

### Phase 4 — Exercise engine + cards (2–3 days)

- `packages/core`: `Card`, `ExerciseDef`, registry; backend generate/grade;
  frontend component map; built-in `translate.*`, `multiple_choice`,
  `type_listen`, `converse`.
- Seed the first curated decks: the **Mandarin** and **Japanese frequency** lists
  - LLM deck generation.
- **Acceptance:** run a practice session mixing exercise types; each yields a
  graded result; adding a new exercise needs no core edits (documented).

### Phase 5 — Pronunciation (`speak_word`) (1–2 days)

- Pipeline §9.4: ASR + aligner + deterministic features + OpenRouter judge with
  JSON schema; per-word feedback + score; record/playback UI.
- **Acceptance:** mispronounced word scores lower; missing word detected; feedback
  references the right word.

### Phase 6 — Gamification (1–2 days)

- XP ledger + level curve + streak + daily goal; HUD; event bus wiring.
- **Acceptance:** completing exercises raises XP, levels up, updates streak;
  XP rebuilds from `xp_events`.

### Phase 7 — Nix packaging polish + docs (1–2 days)

- `nix/package.nix` (compiled binary + assets), `nix/speech.nix`
  (`tutor-fetch-models`), `nix run .` full launch; `just bench`; README quickstart.
- **Acceptance:** `nix run .` serves the app from a clean checkout (after
  `fetch-models`); no store-time Metal needed.

### Phase 8 — post-MVP

- **Done:** professions (22) with **per-action levels** (each action capped at 100;
  the profession level is the mean of its actions, so it reads out of 100 and new
  content lowers it), talents (minor every 5 / major
  every 10), materials + crafting chains, equipment & gear-gated combat actions,
  deeper combat (monsters, HP, damage rolls, drops), **FSRS-6 spaced repetition**
  (Anki 25.07-style scheduler with the V6 default weights, learning/relearning
  steps and desired retention) + a guided curriculum with unlocked lessons.
- **Next:** streaming/barge-in voice, phoneme GOP precision
  mode, achievements/quests/leaderboards on the event bus, second speech provider
  (OpenRouter audio / whisper.cpp), cloud sync / federation, launchd/nix-darwin module.

---

## 20. Decisions

### Resolved

| #   | Decision                    | Choice                                                                                                                                                                             |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Product / package name      | **`tutor`** (kept)                                                                                                                                                                 |
| 2   | Frontend                    | **SvelteKit** — most performant at runtime; shipped as a **mobile-first PWA** for Android                                                                                          |
| 3   | First languages / levels    | **Mandarin**, **Japanese** — both frequency-ordered, one word per step (themed HSK 1 / JLPT N5 decks were dropped)                                                                  |
| 4   | OpenRouter models           | **User-selectable per role in-app** from OpenRouter's catalogue (defaults: Qwen for convo/judge, cheap model for generator/translator); works with any key (DeepSeek, OpenAI, …)   |
| 5   | Voice strategy              | **User-selectable**: **CustomVoice presets** _or_ **VoiceDesign** personas (per language), switchable in Settings; one TTS checkpoint resident at a time (§9.2). Cloning → Phase 8 |
| 6   | Idle timeout                | **1 hour** (configurable)                                                                                                                                                          |
| 7   | Speech provider abstraction | Build the **provider interface now** (local mlx-audio + cloud fallback), so swapping is trivial                                                                                    |
| 8   | Client deployment           | Mac = server; phones = PWA over **HTTPS** (mkcert) — required for mic (§14.1)                                                                                                      |
| 9   | Multi-user                  | **Local accounts** (username + password, argon2id), **fully isolated** per-user history/settings/keys; first user is admin; per-user OpenRouter key with server fallback (§12.5)   |

### Still open (non-blocking)

- Exact default OpenRouter ids for each role (will propose in Phase 2).
- Which preset voice per language is the "default tutor" (propose `Serena` for
  Mandarin, `Ono_Anna` for Japanese, then let the user change it).
- Retention policy for stored audio (keep forever vs prune after N months).

---

## 21. References

- Qwen3-TTS (Apache-2.0): https://github.com/QwenLM/Qwen3-TTS
- Qwen3-TTS blog: https://qwen.ai/blog?id=qwen3tts-0115
- Qwen3-ASR / ForcedAligner / TTS in MLX (mlx-audio):
  https://github.com/Blaizzy/mlx-audio
- mlx-audio docs: https://neywa-labs.github.io/mlx-audio/
- MLX: https://opensource.apple.com/projects/mlx
- Qwen3-Omni (rejected, too big): https://github.com/QwenLM/Qwen3-Omni
- OpenRouter audio APIs: https://openrouter.ai/blog/announcements/announcing-audio-apis/
- OpenRouter multimodal audio guide:
  https://openrouter.ai/docs/guides/overview/multimodal/audio
- Selected models:
  - https://huggingface.co/mlx-community/Qwen3-ASR-1.7B-8bit
  - https://huggingface.co/mlx-community/Qwen3-ASR-0.6B-8bit
  - https://huggingface.co/mlx-community/Qwen3-ForcedAligner-0.6B-8bit
  - https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16
  - https://huggingface.co/mlx-community/silero-vad
