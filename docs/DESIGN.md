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

- Local TTS + ASR using **small, fast speech models that fit in 16 GB**.
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

## 4. Research: the speech model landscape

### 4.1 ASR — Whisper large-v3-turbo

- [Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo)
  (OpenAI, MIT): the distilled large-v3 decoder — 4 decoder layers instead of 32,
  ~809M params — trading a sliver of accuracy for a large speed-up. 99 languages,
  including every language the app offers (zh, yue, ja, ko, de, fr, es, it, pt,
  ru).
- Autoregressive, so it *can* invent a phrase from silence — we keep the energy
  VAD guard (§9.3) and rely on Whisper's own `no_speech_threshold`.
- **Context biasing is a footgun for short takes:** `hotwords` fold into Whisper's
  initial prompt, and on a short clip the decoder tends to *continue the prompt*
  rather than listen — bias it with the deck vocabulary and the learner who says
  いる hears います back. The generic `/v1/asr` route still takes `hint`, but
  pronunciation assessment (`/v1/assess`) decodes unbiased; the forced aligner is
  what anchors the attempt to the expected text (§9.4).
- Its output script is not pinned: Mandarin can come back Simplified, so the
  gateway realigns the transcript to a Traditional reference when one is given
  (`models.match_script`, §9.3).
- MLX support: `mlx-audio` ships the conversion
  (`mlx-community/whisper-large-v3-turbo-asr-fp16`; 8/6/5/4-bit variants exist).
- Companion: **Qwen3-ForcedAligner-0.6B** still gives **word-level timestamps**
  when you supply the expected text → this is our pronunciation-scoring backbone.

### 4.2 TTS — VoxCPM2

- [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) (OpenBMB, Apache-2.0): a
  **2B tokenizer-free** multilingual model, 48 kHz output, 30 languages
  (English, Mandarin, Japanese, Korean, German, …).
- **Voice design *is* the voice system:** there are no named speakers. Passing
  `instruct` ("a calm, professional teacher…") switches it into voice-design mode
  and that description becomes the tutor's voice — which is exactly the Settings
  feature the app already had, now with nothing else to configure.
- It infers the language from the text, so **one checkpoint covers every language
  the app offers** — Korean, German, Russian and Cantonese included — with no
  fallback model and no per-language voice packs.
- MLX support: `mlx-audio` ships `VoxCPM2-{bf16,8bit,4bit}`; we run **8-bit**
  (3.2 GB) so ASR + aligner + VoxCPM2 still fit in 16 GB.
- Cost: **RTF ≈ 0.45** warm — slower than a tiny vocoder would be, but still
  faster than playback, and the sentence queue hides it (§9.2).

### 4.3 Alternatives

- The **Qwen3 speech family is gone** except for **Qwen3-ForcedAligner-0.6B**,
  which has no replacement and is what produces the word timings pronunciation
  scoring needs. No Qwen ASR or TTS checkpoint is referenced any more.
- **Kokoro-82M** and **SenseVoice-Small** were removed too: one model per role
  keeps the gateway, the deps and the docs simple.
- **CosyVoice 3** was evaluated and rejected: it has no MLX implementation in
  `mlx-audio` (only the `mlx-audio-plus` fork, which collides on the `mlx_audio`
  namespace and drops the forced aligner), and it has no built-in voices — every
  clip needs a reference recording.

### 4.4 The runtime — `mlx-audio` (Neywa Labs / Blaizzy)

- MIT. TTS + STT + STS + VAD + music, built on Apple **MLX**.
- **OpenAI-compatible REST server**: `POST /v1/audio/speech`,
  `POST /v1/audio/transcriptions` — so our app can treat speech like the OpenAI
  audio API but hit localhost.
- Supports streaming, quantization, VAD (Silero), forced alignment.
- Swift package (`mlx-audio-swift`) exists if we ever go native.

### 4.5 Too big for this Mac

- **Qwen3-Omni-30B-A3B** (~60 GB fp16, ~16 GB even at 4-bit + encoders) does not
  fit comfortably in 16 GB alongside a browser. **Rejected** for now; the
  cascade (LLM on OpenRouter + local ASR/TTS) is better here anyway because
  it keeps RAM low and gives us a much stronger "brain".

### 4.6 Cloud fallback

- OpenRouter launched **audio APIs (TTS + transcription)** in 2026. We can add a
  `cloud` speech provider behind the same gateway interface for when the local
  models are cold or on a second machine.

### 4.7 Nix findings

- `nixpkgs` has `uv`, `bun`, `nodejs_24`, `python312`, `ffmpeg` (verified on this
  machine). No reliable `mlx` in the store → install via `uv` into a project venv.
- MLX wheels are published for `macosx_*_arm64` cp310–cp313 → plain venv works.

---

## 5. Model selection (what we will actually run)

| Role             | Model (MLX)                                          | ~RAM    | Notes                                      |
| ---------------- | ---------------------------------------------------- | ------- | ------------------------------------------ |
| **ASR**          | `mlx-community/whisper-large-v3-turbo-asr-fp16`      | ~1.6 GB | 99 languages, hotword biasing, script-safe |
| **ASR (lite)**   | _(same checkpoint)_                                  | —       | Aliased unless `TUTOR_ASR_LITE` overrides  |
| **Alignment**    | `mlx-community/Qwen3-ForcedAligner-0.6B-8bit`        | ~1.3 GB | Word timings → pronunciation scoring       |
| **TTS**          | `mlx-community/VoxCPM2-8bit`                         | ~3.2 GB | 2B, 30 languages, voice design             |
| **VAD**          | Silero v4 in the browser (ONNX, `@ricky0123/vad-web`) | 0 (phone) | Silence trimming before upload (§9.3)   |
| **LLM (brain)**  | OpenRouter (cloud)                                   | 0       | Chat, grading, exercise generation         |

`TUTOR_ASR` and `TUTOR_TTS_PRESET` can still point at another checkpoint of the
same family (e.g. `whisper-large-v3-turbo-asr-8bit`, `VoxCPM2-4bit`), but the
gateway only implements those two families plus the Qwen3 **forced aligner**.

**Resident budget while active:** ASR + aligner + TTS ≈ **~6.1 GB** active,
~8 GB peak, leaving the rest for macOS + browser. **When idle, everything is
released** (§8).

**Measured on this machine** (Apple M6 / 16 GB / macOS 27, `just bench`, after warm-up):

| Stage                          | Result                              |
| ------------------------------ | ----------------------------------- |
| load VoxCPM2-8bit              | 2.0 s → 3.2 GB MLX                  |
| load Whisper large-v3-turbo    | 0.7 s → 4.8 GB cumulative           |
| load ForcedAligner 0.6B        | 0.6 s → 6.1 GB cumulative           |
| TTS (warm, Mandarin)           | **RTF 0.44** (2.9 s audio in 1.3 s) |
| ASR (warm, Mandarin)           | **0.7 s**, exact transcript         |
| Align (warm)                   | **0.16 s**, word timings            |
| peak MLX memory                | ~8.0 GB                             |
| **after `unload`**             | **MLX 6.1 GB → ~0** (RAM returned)  |

Whisper transcribed the synthesised Mandarin, Japanese, English, Korean and
German correctly; VoxCPM2 was verified across zh / en / ja / ko / de, including a
7 s multi-sentence clip with no truncation. Cold start (all three) ≈ **3 s**,
hidden by pre-warming when the user opens a voice exercise.

Design policy: models are chosen from one registry in `python/speech/models.py`,
so a size change (`whisper-…-8bit`, `VoxCPM2-4bit`) is a config change, not a
code change.

---

## 6. System architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                 Android phone (SvelteKit PWA, mobile-first)                   │
│   chat pane · voice recorder · card/exercise renderer · XP HUD                │
│   MediaRecorder ▸ Silero VAD ▸ 16 kHz WAV (speech only)                      │
│   ◂ Web Audio playback of TTS · installable shell · service worker           │
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
│  ASR (Whisper) · ForcedAligner · TTS (VoxCPM2) · VAD · mx.clear_cache()       │
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
| Speech        | **mlx-audio** (Python)                                              | Runs Whisper / VoxCPM2 / the Qwen3 forced aligner on MLX, OpenAI-compatible API                                                    |
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
- VoxCPM2 has no named voices: each request carries an **`instruct`** — the voice
  *description* — and the model renders that voice. The app sends one built-in
  teacher description by default, or the learner's saved description in design
  mode.
- Because VoxCPM2 infers the language from the text, there is **no per-language
  voice mapping and no fallback model**: `models.tts_kind_for()` returns the same
  checkpoint for every language the app offers.

#### Voice options (what "voice strategy" means)

| Option                        | What it is                                                                                                               | Setup       | Best for                                                                | Cost    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------- | ------- |
| **Built-in teacher voice**    | VoxCPM2's zero-shot voice pinned with a fixed `instruct` ("a calm, professional teacher…").                              | none        | The default tutor voice everywhere; consistent across a deck            | low     |
| **Voice design**              | Describe a voice in text ("a warm, patient female teacher in her 30s, slow clear articulation") and it _invents_ it.      | none        | A distinctive tutor persona; different voices per character in roleplay | low     |
| **Reference cloning**         | Give a short clip; it speaks in that voice (`ref_audio`).                                                                | need a clip | Your tutor sounding like a specific person                               | medium  |

**Voice modes in Settings** are two-selectable and map straight onto VoxCPM2:

- **Built-in voice:** one teacher voice for every language, styled by a fixed
  description — nothing to choose, consistent by construction.
- **Voice design:** write a description per language (e.g. "patient Mandarin
  teacher, warm, slow") and the model invents that voice.

**Language coverage:** VoxCPM2 is tokenizer-free and covers all 30 of its
languages, so **every** target the app offers (including ko / de / ru / yue) uses
the same checkpoint — no routing table, no second model. Everything sits behind
the same `/v1/tts` request, chosen by `models.tts_kind_for(language, mode)`.

Because the optional backends are separate checkpoints, **keep only one TTS
checkpoint resident at a time** and swap when the config changes (§8.3). Voice
**cloning** stays Phase 8. Everything is config-driven (`speechOpts(lang)`), so
switching never touches code.

### 9.3 ASR flow

```
record (MediaRecorder)
   │  webm/opus take (tap + breaths + thinking pauses)
   ▼
Silero VAD in the browser (onnxruntime-web) — keep speech windows only
   │  16 kHz mono WAV, silence spliced out
   ▼
/v1/asr (lang hint) ─► transcript
```

- **Silero VAD runs on the phone** (`apps/web/src/lib/vad.ts`): the take is
  decoded, every frame is scored by Silero v4 via `@ricky0123/vad-web`, and only
  the speech windows are kept — leading/trailing silence and long thinking pauses
  are spliced out and the result is re-encoded as a 16 kHz mono WAV. A take with
  no speech at all never leaves the device, so no model wakes for it.
- The weights and the onnxruntime wasm live in `apps/web/static/vad/`
  (~16 MB), generated by `apps/web/scripts/sync-vad-assets.mjs`, fetched lazily
  on the first recording and content-hashed so they cache forever. They are
  *not* precached by the service worker.
- Best-effort by design: if the assets cannot load (or the load takes longer than
  15 s), the raw take is uploaded instead, exactly as before.
- Convert to 16 kHz mono server-side with `ffmpeg` (nix-provided) — the gateway
  sniffs the container, so it does not care whether it got WAV or webm.
- Language hint improves accuracy; auto-detect is the fallback. The short app
  code (`zh`, `ja`, …) is already the ISO code Whisper wants; an unknown code is
  dropped so Whisper detects the language itself.
- **No context biasing for assessment:** the caller may not pass `hint` to
  `/v1/assess`. Whisper folds hotwords into its initial prompt, and on a short
  take the decoder reads the prompt back instead of listening — biasing it with
  the deck vocabulary makes a learner who says いる come back as います. The
  transcript must report what was actually said, so the assessment decode is
  unbiased and the forced aligner (given the expected text) does the anchoring.
  Only the generic `/v1/asr` route takes a `hint`, and nothing in the app uses it.
- **No-speech guard:** Whisper is autoregressive — fed silence or a clipped
  fragment it invents a phrase ("Okay.", "Written.", "嗯。"). The gateway computes
  a cheap energy VAD (`models.has_speech`) and returns `{ text: "", noSpeech: true }`
  for silent/too-short clips instead of hallucinating. The browser-side Silero
  pass above is the first line of that defence; this one catches other clients.
- **Script realignment:** Whisper's Mandarin output can come back Simplified.
  When the expected text / deck vocabulary is Traditional, `models.match_script`
  rewrites the transcript to Traditional so a zhuyin deck does not read as a
  transcription error. The chat path (no reference) keeps Whisper's own script.
- Streaming ASR (WS) is Phase-2 for low-latency turn-taking + barge-in.

### 9.4 Pronunciation judging (approximate)

```
 expected text ─┐
                ├─► ASR (Whisper) ─►  hypothesis text ─┐
 recorded audio ┘                                      ├─► features
                ├─► ForcedAligner(expected) ─► timings─┘
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
- **Accent tolerance (Mandarin):** the Chinese decks are Taiwan-standard
  (Traditional + Zhuyin), so before comparing, each character is folded to its
  accent-equivalent Zhuyin and the common Taiwan mergers are collapsed:
  retroflex→alveolar (ㄓ→ㄗ, ㄔ→ㄘ, ㄕ→ㄙ, i.e. zh→z, ch→ts, sh→s), n→l (ㄋ→ㄌ),
  f→h (ㄈ→ㄏ) and -eng/-ing→-en/-in (ㄥ→ㄣ, but not -ong/-iong). A learner whose
  是 is heard as 四 is not marked missing; tones are kept, so a wrong tone is
  still an error. See `pronunciation/variants.ts`.
- **Timing anomalies:** per-word duration vs expected syllables (too fast/slow),
  long pauses (hesitation), truncation.
- **Speech rate** (syllables/sec) vs target.

Then the LLM judge turns those numbers into a 0–100 score and _human feedback_.
The judge is given the card's own Zhuyin/kana reading to copy verbatim (it is
unreliable at recalling it, and has produced wrong readings and Latin
sound-alikes such as "shee"), and is told to accept the Taiwan mergers and not to
invent a diagnosis when the transcript is an unrelated word.

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

- **XP ledger** (append-only) tracks review XP; it drives the **daily goal** and the
  **streak**, not the level. The **account level** is *derived*: the mean of every
  profession's level (§13.5), i.e. a percent-complete figure out of 100 — 1 when you
  start and 100 when every action is maxed. Adding a profession or an action lowers
  it, which is the point.
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
language drills: you pick a profession action, the app gives you "the next drill",
and a correct answer awards that action's XP and materials. Since the idle pivot
(§13.5.1) it is also an **idler** — a correct drill does not just hand you a
material, it *powers a machine* that keeps working while you are away: it produces
items **and earns the action's XP** on its own, so a profession levels from the runs
as well as from the drills.

**Actions are exercise-agnostic.** A profession action defines its tier, its own
XP pool, materials and unlock/equipment requirements — but not the exercise type.
The trainer picks the eligible drill you have practised *least recently*
(`pickNextExercise`), so you always get variety instead of the same question type.
The action — `Mine copper` — is also the unit that **levels up**; see below.

**23 professions** in four groups:

| Group | Professions |
| --- | --- |
| Gathering | Mining, Woodcutting, Fishing, Farming |
| Artisan | Smithing, Cooking, Herblore, Fletching, Runecrafting, Crafting, Firemaking, Construction, Enchanting |
| Support | Thieving, Agility |
| Combat | Attack, Strength, Defence, Constitution, Ranged, Magic, Prayer, Slayer |

**Materials & chains** (59 items) — gathering produces raw goods, artisans refine
them, combat consumes gear. Enchanting is the second-order artisan: it binds cut gems
(Crafting) and runes (Runecrafting) into amulets, robes and blessed blades for Magic:

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

**Recipes can gate on a second profession.** An action's `requires` is a list, so a
tier-4 bar needs both the Smithing level *and* the Mining level that fed it, a super
attack potion needs Herblore *and* Farming, and the enchanter's gear needs
Enchanting *and* the artisan that made the base item (`enchant-blade` needs
Enchanting 20 and Smithing 25). The result is a web, not a row: to reach tier 5 you
train two professions, and each one's output is the other's input.

**The level lives on the action, not the profession.** Every action has its own
XP pool and its own level, and its own passive that grows with *that* action:
gathering +1% **of the action's own output**/level (`Mine copper` gives more
copper, `Mine essence` more essence — not more of everything), artisans +0.5%
bonus-product chance/level, Agility +0.5% **XP to every profession**/level, combat
+1% power/level, Slayer +1% rare drops/level, Thieving +2% coins/level.

**The curve is scaled for the idle era.** One action level costs
`100 + (level − 1) · 10` XP, so maxing a single action is ≈58.4k XP and a 4-action
profession ≈234k — **10× the drill-only curve**, because a live rig also earns XP on
its own (§13.5.1). Level 100 is a long goal, not an impossible one.

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
"everything in this profession is maxed".

**The account level is the same idea one rung up.** The **Home level** is the mean
of all 23 professions, out of 100 — a percent-complete figure, 1 at the start and
100 when every action is maxed. It is *derived*, never stored: drills and the idle
rigs both feed the professions underneath it, and shipping a new profession (or a
new action inside one) lowers it until that content is trained. Nothing levels the
account directly — the review XP ledger drives the daily goal and the streak, not
this number. `accountLevel()` in `game/service.ts` computes it on read.

**Talents** are still per profession, taken at milestones of the derived level:
- **Every 10 levels** (10, 20, 30, …) → choose **one of three** talents:
  *Prospector* (+15% yield on every action of the profession; combat professions
  instead get *Keen strikes*, +15% power), *Studious* (+5% XP to every profession),
  or the profession's **synergy** talent. A choice can be changed later at the same
  milestone (a free respec).
- **Synergy talents are how the professions build off each other.** A synergy
  talent feeds a bonus into *another* profession, **scaled by the owning
  profession's own derived level**. Mining's *Ore Sense* gives Smithing +0.5% XP
  per Mining level; Smithing's *Deep Veins* gives Mining +0.5% yield per Smithing
  level; Magic's *Arcane Study* feeds Enchanting, and so on for all 23. `Mod`
  carries the link (`{ kind, value, skill: target, synergy: owner }`) and
  `computeBonuses` resolves it against `skillLevelsFrom(actionLevels)`, so the gift
  grows as you invest — training one profession levels another faster.
- **Mastery capstones at Lv 50 and Lv 100.** Each capstone offers **two** options and
  *both* are gated on the profession that feeds this one (`SYNERGY[skill].target`):
  **Grandmaster <Name>** (Lv 50) — +25% XP to this profession's own actions, which
  still matters because you are only halfway (needs the partner at 20); **Legendary
  <Name>** (Lv 100) — instead a **permanent output bonus**, the profession's own
  passive at capstone strength (`+25% yield`, `+10% bonus product`, `+20% power`, …;
  needs the partner at 40). The Lv-100 self option deliberately grants **no XP**: a
  profession only reaches 100 once every action is already capped, so its XP would
  buy nothing. The second option is either **Patron of <Partner>** (+0.5% partner XP
  **per level of this profession**) or **Grand Patron of <Partner>** (+1% per level)
  — a gift to a line that is *not* maxed — gated on the partner at 30 / 50. A
  mastery is therefore earned by *cross-training*, not grinding one profession. It is
  stored with `tier = 'mastery'`, so it never consumes a 10-level choice: the two
  tracks run side by side and both respec freely.

Talent ids encode skill + milestone + tier (`<skill>:t:<milestone>:<n>` for choices,
`<skill>:m:<milestone>:<n>` for masteries), so progression continues indefinitely.
All effects aggregate through `computeBonuses(actionLevels, talents)`.

**Equipment & combat:** Smithing forges weapons, body and leg armour, Fletching
makes bows, arrows and staffs, Crafting makes leather armour, and Enchanting binds
gems and runes into amulets, robes and blessed blades. A fight uses **whatever you
have equipped** — you never pick a weapon or a skill: power and armour are summed
across every worn piece (weapon, body, legs, neck). The equipped weapon's tag decides
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
`item.gained`, `item.consumed`, `talent.chosen`, `talent.changed` (both tagging the
talent `tier`), `item.equipped`.

### 13.5.1 Idle rigs — a drill starts a machine (the idle pivot)

**The old model was one drill = one item.** The pivot: **one drill powers a
machine.** A correct drill still lands one immediate *strike* — the old flat yield,
so the loop keeps its heartbeat — but its real reward is that it **starts a run**:
a stretch of real time during which the action keeps producing its `produces`,
consuming its `consumes`, and **earning its XP** by itself. Keep completing drills
for the same action and every run is **faster**, **longer** and worth more XP per
item; stop, and the run drains out and the rig falls still. This is what makes the
game reward *taking a break* and *coming back*.

```
   complete 1 drill          complete 10 more             come back in 4h
   ─────────────────         ─────────────────            ──────────────
   +1 ore  (the strike)      +1 ore  (the strike)         bank is full
   run: 1 / 10s for 10 min   run: 1 / 7s for 48 min       pick new drills
```

**Nothing ticks.** There is no scheduler, no worker, no timer. A run is *not* a
loop that runs every second — it is a **function of recorded facts and the clock**.
Per `(user, action)` the database keeps only what a completion already tells us:

| stored | meaning |
| --- | --- |
| `completions` | how many drills this action has ever completed — drives rate & length |
| `run_ends_at` | when the current run expires (ms; `0` = still) |
| `settled_at` | the cursor: accrual has been credited up to here |
| `crafts` | fractional crafts carried between settles (keeps `consumes` integral) |
| `remainder_json` | sub-item fractions carried per produced item (no rounding loss) |

Given those numbers and `now`, the whole gain is **one closed-form
computation** — `dt = clamp(now, settled_at, run_ends_at) − settled_at`, credited
at the constant rate `craftsPerSec(completions)`. No per-second loop, no missed
ticks, no drift. A completion settles the old rate up to *now*, then bumps the
count and extends the run, so the rate is a step function that only ever changes at
a completion. The exact same result can be **replayed from the completion log
alone** (`gather_log`, append-only, one row per drill) — which is why the curve can
be rebalanced later without rewriting anyone's bank.

**The curves.** The *rate* is a saturating exponential; the *run length* is a
**straight, equally-stepped climb**. Both are tunable in `game/idle.ts` (`IDLE`
constants): the first drill is slow and short, a long-lived action approaches a
2-second ceiling, and **50 completions buy the full 6 hours** — every completion
before that adds the same slice of time.

```
intervalSeconds(c, tier) = tierFactor(tier) · (2 + 8 · 2^(−c/15))   // 10s → 2s per item
runSeconds(c)            = 600 + (21600 − 600) · min(c−1, 49)/49    // 10 min → 6 h at c=50
tierFactor(tier)         = 1 + 0.35·(tier − 1)                      // tier 1 ×1 … tier 5 ×2.4
xpPerCraft               = 0.5                                      // action XP per completed craft
```

**A live run earns XP too.** A drill hands over the action's `xp`; while a run is
alive the rig also pays `IDLE.xpPerCraft` for **every craft it completes on its
own** (a gathering rig every item, an artisan every transformation), credited
through the same `awardActionXp` path so talent XP bonuses apply. So a machine
left running levels its profession the same way drilling does, just by the clock —
that is what makes "leave it running and come back" pay in levels, not only in ore.
`settleAll` accrues it in the same closed-form pass as the items (a completion
count already *is* the craft count, so nothing new is stored), and the action XP
curve is scaled **10×** against the drill-only era to absorb the new income (see
§13.5: ~58.4k XP to cap an action). `xpPerCraft` is `0.5`, so a full 6-hour maxed
run pays ~5.4k XP — enough that the machines carry most of the leveling, but capping
an action takes ~11 such runs rather than a couple.

**Tier slows the rig, not the run.** Higher-tier actions run proportionally slower
per item (`tierFactor`) but keep the same run length, so deep content (adamant,
yew, blessed blades) stays *rarer* without costing you more real time — the run
window is about how long you can be away, and that is the same for everyone. The
table below is tier 1; multiply the interval by `tierFactor` for deeper rigs.

**A flurry of drills can't buy unlimited time.** A drill does not *stack* onto
the previous end; it **re-bases** the run to `rigRunSec(completions)` from that
drill. So a burst of completions makes the next run longer *in step with the
count* — 10 buy ~1.2 h, the 50th buys the full 6 h, and it never exceeds
`maxRunSec`. (`extendRig` sets the end outright, and `settleRig` re-clamps on
every read, so any older row written before this held is trimmed on its next
settle.) Summing a per-drill slice instead reached the 6-hour ceiling after only
~10 rapid drills, which is why a handful of cards used to buy a full night.

| completions | 1 | 10 | 30 | 50 | 100 | 300 |
| --- | --- | --- | --- | --- | --- | --- |
| one item every | 9.6s | 7.0s | 4.0s | 2.8s | 2.1s | 2.0s |
| a run lasts | 10m | 1.2h | 3.6h | 6h | 6h | 6h |
| items per run | 62 | 630 | 3.3k | 7.7k | 10.4k | 10.8k |
| XP per run | 31 | 315 | 1.6k | 3.9k | 5.2k | 5.4k |

**Every action is a rig**, including the artisans. A gathering rig makes something
from nothing; an artisan rig *transforms* — its run consumes the recipe inputs and
produces the outputs, clamped by what the bank holds at settle time. You point your
effort by choosing which action's drills to do: drill `Smelt bronze` and your smelter
runs; drill `Forge iron sword` and your forge runs. Raw materials are effectively
free now, so the game's real currencies are **time** (run length), **attention**
(which rigs you power) and **XP** (levels). XP is no longer drill-only: a run pays
it as it works, so *which rigs you keep alive* is a leveling decision too.

**Settlement order is fixed and deterministic.** `settleAll` walks every action in
one canonical order — `gathering → support → artisan → combat` — against a single
mutable bank, so a mining run's output is available to a smithing run in the *same*
pass. The order is part of the contract: same inputs, same bank, every time.

**Why this is fast.** `settleAll` is `O(actions)` = **67** rows of pure arithmetic.
It reads the rigs and the bank in two queries, credits every live run in one fixed
order, and writes back only what actually changed — and it only ever runs when a
request arrives (`GET /api/skills`, `GET /api/skills/:id`, or a graded drill).
Hundreds of offline hours cost the same as one second. The client never asks the
server to tick: it receives each rig's rate and `runEndsAt` and **extrapolates
locally** every 250 ms so the numbers visibly climb, then reconciles on the next
fetch.

**Rebalance.** With rigs running, raw materials pour in — by design — so the
"1 drill = 1 ore" recipe costs no longer hold up. Two things changed. First, the
**bottleneck moved** to machine time (how long a run lasts, how many rigs you keep
alive), tier (deep rigs run up to 2.4× slower) and XP (levels, which now climb from
the runs themselves, still gate recipes, gear and power). Second, **recipe inputs
were scaled up against an explicit time budget, because this is an idler**: you are
*meant* to leave a 6-hour run going and come back. So the pace is set by how long the
supply rigs must run — a few hours for starter gear, and **roughly a whole day for
the deep gear**, which is four or five "leave it running" sessions spread across days
of study.

The budget is legible, not vibes: an action needs `⌈58410 / xp⌉` drills to reach 100
*if you only drill* — but a live rig also pays `xpPerCraft` per item, so the levels
come from the machines too (a full 6-hour run of a maxed rig is ~5.4k XP, about a
tenth of a cap). Material costs are chosen so the **scarcest raw material** it
consumes works out to the tier's target. Refinement is deliberately the *cheap,
fast* feeder layer (a bar costs 2 ore); the **goal** actions carry the time.

| action → Lv 100 | tier | drills | before | now | ~rig time |
| --- | --- | --- | --- | --- | --- |
| fletch an oak shortbow | 1 | 487 | 1 log | **12 logs** | 4h |
| forge a bronze sword | 2 | 487 | 1 bar | **12 bars** | 8h |
| fletch a willow longbow | 2 | 325 | 1 log | **24 logs** | 7h |
| make a leather body | 2 | 418 | 3 leather | **14 leather** | 8h |
| forge an iron sword | 3 | 325 | 2 bars | **20 bars** | 12h |
| forge steel leggings | 3 | 266 | 3 bars | **20 bars** | 13h |
| string a sapphire amulet | 3 | 266 | 1 gem | **24 gems** | 12h |
| forge a steel platebody | 4 | 195 | 3 bars | **40 bars** | 18h |
| forge a mythril sword | 4 | 183 | 2 bars | **30 bars** | 19h |
| fletch a yew longbow | 4 | 195 | 2 logs | **48 logs** | 13h |
| forge an adamant platebody | 5 | 133 | 3 bars | **38 bars** | 24h |

(The `drills` column is the **drill-only** count at the 10× curve — a live rig pays
`xpPerCraft` per item it makes, so in practice the machines still do most of the
leveling and you only drill to keep them alive.)

Because metal bars each want coal, **coal becomes the deep-game bottleneck** for
armour — thematically right for a forge, and it gives `Mine coal` a reason to exist.
**Deep-chain actions inherit their input's cost**: `Bind a blessed sword` consumes a
tuned mythril sword, so it lands near the tier-4 budget even though the action itself
is tier 3. Consumables barely moved (food is still 1 raw → 1 cooked; potions 2–3×) so
combat keeps its food economy, and `hide` for leather armour still comes from combat
drills (a deliberate combat side-chain). The `strike` and the rig consume the same
scaled costs, so an artisan drill still *gates on materials* — you just get those
materials from machines now. Combat numbers are untouched, and the idler still can't
substitute for studying: you have to drill to **start** the machines, and the action
XP curve is scaled 10× so passive income sharpens the loop instead of replacing it.
The runs reward *coming back*; the drills remain the reason to open the app.

## 13.6 Spaced repetition (FSRS-6, Anki-style) & guided curriculum

Scheduling uses **FSRS-6** — the algorithm Anki 25.07+ uses — through the
reference TypeScript implementation (`ts-fsrs`, FSRS-6 model) with Anki's
**default 21 weights** (`w20 = 0.1542` trainable decay), configurable
**learning steps** (default `1, 10, 60, 240` minutes, so a brand-new card repeats
a handful of times before it graduates) and **relearning steps** (`10m`), and
intervals derived from a **desired retention** (default `0.9`, per-user). An
Anki-style **daily budget** — new cards/day and reviews/day (default 20 / 200),
with a "study more" override — bounds how much a day asks for. The state machine
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

- **A sitting opens on a few new words.** `selectCardId()` puts the due backlog
  first, which is right in the middle of a sitting but feels like grinding at the
  start. So practice warms up: while fewer than **3 cards have been graded in the
  last 30 minutes** (i.e. the sitting is young), the next card is a new one in
  curriculum order; then the due/hardest-overdue card takes over. A pause longer
  than 30 minutes starts a new sitting, so it warms up again. The warm-up never
  overrides the daily budget and never invents a card: with no new words left it
  falls straight through to the review queue. Combat is unaffected — it is
  review-only by design (`pickReviewCard`).
- **A lesson picks the path, not a card pool.** Starting the next step of the
  frequency path drills the **whole deck** (due → new → soonest), not just that
  step's cards. A one-word step has nothing else in it, so a lesson-scoped queue
  used to re-show the same word four or five times while its `1m → 10m → 60m →
  240m` learning steps waited. Now the queue moves on to the path's next new word
  and the learned one comes back only when its step is actually due. The practice
  header follows the card on screen (`POST /api/practice/next` returns its
  `lessonId`), and lesson completion fires only on the transition, not every time
  an already-finished lesson is reviewed. `POST /api/practice/next` also takes an
  optional `cardId` for a targeted drill; the daily budget still applies.

- **Ratings are two-way**: a wrong answer is **Again**, a right answer is
  **Good** — deliberately never Hard/Easy. FSRS is best trained on that honest
  signal, and an auto-derived "Easy" used to graduate a brand-new card after a
  single answer (it vanished for a week with no same-session repetition). Every
  review (practice *and* combat hits) feeds the
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
- **Daily budget** — `newPerDay` and `maxReviewsPerDay` (default 20 / 200; `0`
  = unlimited) bound a day's work. The practice route serves only new cards when
  the new budget is left and only SRS cards when the review budget is left, then
  reports `done` so the UI shows "today's goal reached". A per-day **"study
  more"** override (`study.extraToday`) raises today's allowance without touching
  the standing settings — Anki's custom study.
- **Learning steps** — `learningSteps` (default `1, 10, 60, 240` minutes). These
  decide how many times a brand-new card repeats before it graduates, so a session
  can re-show it instead of dropping it for days.
- **Auto-reinforce** — `autoReinforce` (default on). When a card reaches
  `REINFORCE_LAPSES` lapses, `deck/reinforce.ts` asks the planner for one extra
  sentence/grammar card that practises the same word using only words already met
  (n+1), and adds it to that word's lesson (`payload.reinforces = <cardId>`, once
  per card). `POST /api/decks/:id/cards` is the same insertion path for a
  hand-authored card: a `step` places it in that lesson, no `step` appends a new
  one.

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

- Whisper large-v3-turbo (MIT): https://huggingface.co/openai/whisper-large-v3-turbo
- VoxCPM2 (Apache-2.0): https://huggingface.co/openbmb/VoxCPM2
- CosyVoice 3 (rejected — no mlx-audio port): https://github.com/FunAudioLLM/CosyVoice
- Whisper / VoxCPM2 / the Qwen3 forced aligner in MLX (mlx-audio):
  https://github.com/Blaizzy/mlx-audio
- mlx-audio docs: https://neywa-labs.github.io/mlx-audio/
- MLX: https://opensource.apple.com/projects/mlx
- Qwen3-Omni (rejected, too big): https://github.com/QwenLM/Qwen3-Omni
- OpenRouter audio APIs: https://openrouter.ai/blog/announcements/announcing-audio-apis/
- OpenRouter multimodal audio guide:
  https://openrouter.ai/docs/guides/overview/multimodal/audio
- Selected models:
  - https://huggingface.co/mlx-community/whisper-large-v3-turbo-asr-fp16
  - https://huggingface.co/mlx-community/VoxCPM2-8bit
  - https://huggingface.co/mlx-community/Qwen3-ForcedAligner-0.6B-8bit
  - https://huggingface.co/mlx-community/silero-vad
