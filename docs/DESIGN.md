# Tutor — AI-first language learning app

> The design of the system **as built**: what each part does and why. Code
> comments cite it by section (`DESIGN §13.5.1`), so section numbers are stable.
> For where code lives see [`ARCHITECTURE.md`](ARCHITECTURE.md); for open defects
> see [`BACKLOG.md`](BACKLOG.md).
>
> Target: Apple **M6**, **16 GB** unified memory, macOS 27 (server) + **Android
> PWA** (primary client, mobile-first).
> One-liner: a local-first, Duolingo-like language tutor where the **brain is
> OpenRouter** (user-selectable model) and the **speech is local on MLX** (Whisper
> for ASR, VoxCPM2 for TTS), with permanent chat/voice history, an extensible card
> + exercise engine, and a profession/idle game layered on spaced repetition.

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

### 4.3 Rejected

One model per role keeps the gateway, the deps and the docs simple. Rejected:
the rest of the Qwen3 speech family (only the forced aligner remains — nothing
replaces its word timings), Kokoro-82M and SenseVoice-Small (redundant),
CosyVoice 3 (no `mlx-audio` port, no built-in voices) and Qwen3-Omni (too big
for 16 GB). MLX is installed with `uv` into a venv on disk: nixpkgs has no
reliable `mlx`, and the Nix sandbox cannot use Metal.

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
hidden by pre-warming when the user opens an exercise the model serves.

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
    core/          # shared types, card templates, card/exercise registry contracts
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
| Data fetching | `cachedResource` + `lib/api.ts`                                     | Cache-first paint, one in-flight request per path, revalidate in the background                                                    |
| Validation    | **JSON Schema**                                                     | Hand-written schemas sent to OpenRouter (`chatJSON`); answers re-checked in `exercises/verify.ts`                                  |
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
  opens an exercise that needs it, which pre-warms it). Listen cards play
  pre-recorded clips and never wake it.
- On spawn, the sidecar binds a localhost port and reports `/health` until models
  are loaded. First-utterance latency includes model load (~2–6 s). We hide this
  by pre-warming when the user enters a drill the model serves or clicks record.

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
- **Explicit:** a "Free memory" button in Settings calls `unload` — **admin
  only**, because the gateway is shared and stopping it cuts off every member.

### 8.4 Latency tradeoff (documented)

| State            | First-utterance cost                   |
| ---------------- | -------------------------------------- |
| Warm             | ~0.3–1 s (streaming TTS first packet)  |
| Cold start       | ~2–6 s model load (spinner + pre-warm) |
| Mid-conversation | Warm; idle timer keeps resetting       |

Config knobs: `TUTOR_SPEECH_IDLE_TIMEOUT`, `TUTOR_SPEECH_AUTOSTART`.

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
POST /admin/shutdown                 → stop a gateway the server did not spawn
POST /v1/warm                        → load the speech models ahead of the first use
POST /v1/asr                         → { audio: base64|multipart, language?, hint? }
                                        → { text, segments[], lang, ms }
POST /v1/assess                      → { audio, text, language? } → transcript + word
                                        timings for pronunciation scoring
POST /v1/tts                         → { text, voice, language?, instruct?, stream }
                                        → audio/wav  (or chunked stream)
```

The gateway **defaults to the OpenAI-compatible shape** from `mlx-audio` where
possible, and adds `/v1/assess` + the admin/lifecycle routes. Browser VAD (§9.3)
trims the silence, so the gateway never loads a VAD model of its own.

### 9.2 TTS flow (fed by the OpenRouter response)

```
OpenRouter token stream ─► sentence splitter ─► /v1/tts (stream) ─► Web Audio
        (text)                 (incremental)        (per sentence)     (play)
```

- Chunk by sentence so playback starts before the full reply is generated.
- VoxCPM2 has no named voices and no language parameter: each request carries
  an **`instruct`** — the voice *described in words* — and the language is
  inferred from the text.

#### Voices (fixed, not a setting)

There is nothing for the learner to configure. `packages/core/src/voice.ts`
defines **four voices**, the same in every language: a **teenager** and a
**teacher** of each gender. Recorded card audio uses all four (one clip each, a
random one per play); live playback and each chat reply pick one at random.

- **Accent rides in the description.** Each language appends its accent to the
  voice (`voiceInstruct`): Taiwanese Mandarin, Hong Kong Cantonese, Tokyo
  Japanese, Seoul Korean, Hochdeutsch, Latin American Spanish, and so on. This is
  a request, not a guarantee — the model documents dialect control only for
  Chinese dialects.
- **Text is spoken as written.** A Japanese word keeps its kanji even though a
  kanji-only word (先生, 水) can be mistaken for Chinese: the kanji is what
  identifies the word and its pitch accent, which kana alone cannot (橋 / 箸).
  A wrong-language reading is caught by grading the clip, not by changing the
  text.
- **Every recorded clip is graded before it is kept.** The speech model is
  unreliable on short text: it can add a sentence after a single word, make
  noise instead of the word, or read a Japanese word as Chinese. So each take is
  transcribed by the gateway's own recogniser and kept only if it says the
  card's text and nothing else (`apps/server/src/audio/verify.ts`). A single
  word must match exactly or sound identical (他 / 她, 橋 / 箸); a sentence may
  differ by a few characters. A bad take is recorded again, up to three times;
  if none passes, no clip is stored (`rejected` in `GET /api/audio/status`).
  The recogniser checks words, not melody: it cannot hear a wrong pitch or accent.

**Language coverage:** VoxCPM2 is tokenizer-free and covers all 30 of its
languages, so **every** target the app offers (including ko / de / ru / yue) uses
the same checkpoint — no routing table, no second model. Everything sits behind
the same `/v1/tts` request, chosen by `models.tts_kind_for(language, mode)`.

Voice **cloning** is not built.

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
have set: `GET /api/models` (filtered by that key's provider preferences, privacy
settings and guardrails) when a key is present, falling back to the public
catalogue otherwise. Defaults on first run (all OpenRouter ids, so swapping is one
click):

- `conversation` + `judge` → a strong general model (e.g. a Qwen3 flagship).
- `generator` + `translator` → a cheap/fast model.

Because roles are just ids, a user whose key is provisioned for **DeepSeek**,
**OpenAI**, **Anthropic**, **Gemini**, etc. can point every role there without any
code change. We persist the per-role choice in `settings`, validate that the key
can list the chosen model, and fall back to a default on error. Expose a
per-role "test" button and show cost/latency so switching is informed.

### 10.2 Integration

- `POST /api/chat` with `stream: true` → SSE relayed to the UI; `/api/chat/json`
  returns a single structured reply for flows that must not stream.
- **Structured outputs** (`response_format: json_schema`) for grading and card
  generation; validate against the same schema, retry once on failure.
- **Tool calling** for "the tutor decides to present a card / start a drill".
- Record token usage + cost per message; surface in a dev panel.

### 10.3 Prompt architecture

Every prompt is built on the server; the shared pieces live in
`apps/server/src/llm/prompts.ts`. They are written for small models:

- **One shape.** Who the model is, what it is given, what to return, then the few
  rules that matter — each stated once, as a positive instruction. Graders get
  labelled inputs (`Word:`, `Learner's answer:`) and an explicit meaning for
  `correct`, `score` and `feedback`.
- **Only the rules that apply.** The script rule (`scriptRule`) is derived from
  the deck's own settings — Traditional or Simplified, Zhuyin or pinyin, kana — and
  is attached only for the language it concerns. A pinyin deck is never told to
  write Zhuyin, and a Japanese learner is never told about Chinese. Graders read
  the deck through the card they grade, so a Simplified deck is graded in
  Simplified; with no card, the app's default (Traditional with Zhuyin) stands.
- **The tutor's reply is spoken.** The conversation prompt asks for plain
  sentences (no markdown, emoji or bracketed readings), and the client strips
  anything of that kind before synthesis (`speakable` in `apps/web/src/lib/speech.ts`).
- **Feedback is in the learner's language**, restated as the last line of every
  grading request, because a small model otherwise drifts into the target language.
- **An answer to a question is in the learner's language only.** When the
  learner asks what something means or writes in their native language, the
  conversation prompt has the tutor explain in that language and add no target
  sentence, or the model appends "carry on" chatter in the language being learned.
- **There is no account-level target language.** What is practised comes from
  the deck in use — grading reads the card's own language, and the conversation
  takes the active deck's language — while a question about any other language is
  still answered in the learner's native language. The account keeps only
  `native_lang` and `level`.
- **The deck planner shows one worked example** in the deck's own language and
  reading script (`deck/planPrompt.ts`); models copy an example's shape closely.
- **A path tells the planner what to teach.** The default deck is a *path*
  (§13.7): its instruction is composed by the app (`pathInstruction`,
  `deck/path.ts`) — everyday spoken language for reading manga, manhwa and
  manhua, one sentence per word, grammar as a single-word blank — so the learner
  picks a language and never writes a prompt. A custom deck still passes the
  learner's own text.
- **A generated batch passes a reviewer the deterministic drills cannot
  replace.** `deck/review.ts` sends the batch to the judge model and keeps, fixes
  or drops each card on its meaning, grammar and reading; a fix is applied before
  the card is stored, and a card the reviewer never mentions is left alone.
- **A grammar card teaches, it does not just name its point.** `payload.rule`
  names it without the word that fills the blank (the drill shows that line as a
  hint, so it must not give the answer away), `front` names every form of the
  point ("Topic particle 는 / 은"), and `payload.explanation` is two to four
  sentences that say what it means, when each form is used and the mistake
  learners make — the intro screen and the graded feedback both read it out.
- **A word that is itself a grammar point is introduced by its grammar card.**
  A particle, copula, conjunction, auxiliary or classifier is not a vocabulary
  item, so the planner writes one grammar card for it — `front` names the point
  and its forms, `back` is the word, `payload.explanation` says how it is used —
  and no vocab card. The build marks that card `payload.intro` (`acceptPlanned`
  in `deck/build.ts`, kept only when the point names its own word and no vocab
  card competes), and it then counts as the word's introduction: it takes the
  step, joins the known words for the cards after it (`keepDrills`,
  `persistStep`) and is what growth calls a word already met
  (`introducesWord` in `deck/growth.ts`). A grammar card that only teaches a
  pattern keeps the vocab card for the word it blanks. The deck schema makes
  `explanation` required on the grammar card variant, so the model cannot leave
  the teaching text out, and an intro card that still arrives without
  `payload.explanation`, with a bare label instead of one, or past the
  800-character cap is dropped before it is stored (`sanitizePlannedCard` in
  `deck/plan.ts`), so the batch is planned again rather than shipping a card
  that teaches nothing. A point the prompt has no blank for yet (は needs a noun
  and a copula before it can be blanked) keeps its explanation on the word card
  instead, so the intro still defines it; the word card shows the explanation
  the planner wrote. A grammar card is built with its example: after the batch is
  persisted the build writes one sentence with the example planner and keeps it
  only if it passes the same word checks and drill grading as any other sentence
  (`attachGrammarExamples` in `deck/build.ts`). A card that still lacks one is
  filled in the background the first time it is served, so the drill never waits
  on the model (`fillGrammarTeaching` in `deck/grammarExamples.ts`); until then
  the intro falls back to a sentence built from the card's own prompt.
- **A language's traps are named, not assumed.** For Chinese the planner is told
  that 這/那 are not places and 來/去 need one (`motionRule`), and the build drops
  a sentence that still writes 來這/去那 (`motionWithoutPlace` in
  `deck/context.ts`) — an odd sentence teaches something wrong.
- **A generated example is graded before it is kept.** When the planner returns a
  batch, every sentence and grammar card is run through the drills it supports
  (`exercises/verify.ts`): the drill must offer its own right answer — a choice
  list that contains it, a token bank that holds every token — and grading that
  answer must come back correct, or the card is dropped and logged
  (`keepDrills` in `deck/build.ts`). This is the card-side twin of grading each
  recorded clip before it is stored.
- **Every word gets a sentence.** The planner writes one example sentence for
  every vocab card, not one every few, so a deck inflates but each word arrives
  with usage. The same checks keep them honest: a sentence is dropped when it
  leaps ahead of the words met, when it holds a word the learner has not met, or
  when its drills do not offer and grade the right answer (`skipExample` and
  `keepDrills` in `deck/build.ts`). Existing decks catch up with
  `scripts/rebuild-sentences.ts`, which deletes a deck's sentence cards and
  regenerates one per word through the same build.
- **n+1 covers grammar, not just sentences.** The build drops any example whose
  target-language words are not yet met: sentence tokens and distractors, and now
  a grammar card's answer and the words of its prompt (`targetWords` in
  `deck/context.ts`). A card that cannot be written from what the learner knows is
  not written at all.
- **The same check runs on demand.** A deck's settings carry **Check all cards**
  (`POST /api/decks/:id/audit`, `deck/audit.ts`): it scans the deck with the
  generation rules and reports each card that fails, then a second press drops the
  failures and prunes the choice words the learner has not met. It exists so a
  prompt change can be tested against the cards already in a deck, not only the
  next batch.
- **Grading is repeatable** (temperature 0.2) and never blocks a review: a judge
  that fails or times out falls back to the deterministic grade.
- **A submission is capped at 15 seconds on the client.** While it runs the whole
  card is covered by a spinner (`ExerciseStage.svelte`), so a slow voice grade
  does not read as a frozen drill; when the deadline passes
  (`gradeSignal` in `apps/web/src/lib/exercises.ts`) the card comes back with an
  error to retry instead of waiting on a stalled judge. The overlay leaves the
  drill mounted underneath, so a timed-out typed answer is not lost.

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
  payload: Record<string, unknown> // type-specific extras (schema-validated)
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
preferred reading and the words the ministry dictionary omits). When that
preferred reading is a 合音 (contraction) the ministry lists as a secondary
reading — 這 as ㄓㄟˋ rather than ㄓㄜˋ — the ministry's primary reading wins, so
an isolated character reads the same as it does inside a word. The deck builder
overrides the generator's reading for a `zh` deck, except where the word came
with its own reading (an Anki import) — that is the source deck's authority.
Only Traditional characters have entries: Zhuyin is a Taiwan script, so a
Simplified or pinyin deck keeps the generator's reading.

Cards come from: a curated starter deck, LLM generation ("give me 20 HSK-1
food words"), or manual entry.

**Listening audio is pre-recorded, sentence-only.** A listening card plays
files, not a fresh TTS call: when an utterance card is created (or on the first
play of an older one) its target text is recorded in four voices — a teenager
and a teacher of each gender (§9.2) — and stored content-addressed under
`$TUTOR_DATA_DIR/audio/` (§12), keyed by voice, **language** and text: Mandarin,
Japanese and Cantonese share written words (先生, 水), and each is read in its
own language. Single-word vocab is never recorded: `enqueueCards` keeps only
`isUtterance` cards, and the new-word screen no longer plays a lone word.
`GET /api/cards/:id/audio` streams one voice (a random one per play, or
`?variant=N`), so playback never wakes the speech model. Recording runs through
a serial background queue (`apps/server/src/audio/`), and
`POST /api/audio/backfill` (or `scripts/backfill-audio.ts`) records a whole
existing library, resuming wherever it stopped. The queue is shared by every
member, so starting a backfill and `POST /api/audio/cancel` are **admin only**.

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

- The contract lives in `packages/core` (`ExerciseDef`, `ExerciseRegistry`).
- Each backend drill is one file under `apps/server/src/exercises/defs/`;
  `apps/server/src/exercises/index.ts` registers them and resolves
  `id → generate/grade`. The **frontend maps `id → Svelte component`** in
  `apps/web/src/lib/components/exercises/`.
- Adding an exercise = one file in each place + a registry line. Nothing in the
  core needs editing → this is _the_ extensibility promise.

The server layout (game / db / services / routes, and the content tables) is in
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

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

**Multiple choice reuses what the member has met.** For a vocab card the wrong
answers are other met cards' backs; for a sentence card they are the card's own
sentence with one token swapped for each `payload.distractor` — the planner's
"known words that do not belong in the sentence" (`defs/multipleChoice.ts`). The
swap lands on the token that shares the longest suffix and closest length with
the replacement, so a weekday card offers 本日は土曜日です beside 本日は金曜日です
instead of four unrelated words.

**Listening and speaking are sentence-only.** `type_listen` and `speak_word`
support a card only when it is an utterance (`isUtterance` in
`exercises/payload.ts`: the card's type is `phrase`), never a single word — a word
played or spoken on its own does not tell the learner what it means. The card type
carries this: a "sentence" the planner segmented as one token is a word, so
`storedTemplate` (`deck/plan.ts`) stores it as a `vocab` card and migration
`0025_single_word_cards_are_vocab.sql` relabels the starter decks' short words
(네, 謝謝). Word cards keep the text drills and `converse`. Free
production waits for a base: `converse` is offered only once the member has met a
sentence card in that language or knows enough words there to attempt one
(`available` in `defs/converse.ts`), so a brand-new word is never answered with
"write your own sentence." The drill grades the **word, not the sentence**: the
judge answers `wordCorrect`, true only when the word carries its own meaning in
the place it was put — a word sitting where a different one belongs is wrong even
though it is there. When it is correct the rest of the sentence never fails it:
other mistakes come back as feedback and the score is floored at 75
(`defs/converse.ts`). The code also requires the word to be in the answer, so a
generous judge cannot pass a sentence that leaves it out. `speak_word` was switched off product-wide while it ran on words; it is on again
now that it is sentence-only, and a forced call is swapped for an allowed kind
when the card does not support it (`isBlocked` in `routes/practice/next.ts`).

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
      native_lang, level, settings_json, created_at, updated_at)
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
  Cookie is `Secure` automatically when served over HTTPS, and its `Path` is the
  app's base path (`/tutor` behind the gateway), so other apps on the same
  tailnet hostname never receive it.
- **Everything is personal.** Every request resolves the session to a member.
  A member's **progress** is theirs alone: the schedule, review history, XP,
  chats, settings, inventory and gear are all scoped by `user_id`. **Decks and
  cards are theirs too** — each account builds its own path — so `decks.user_id`
  is the owner and `listDecks`/`listCards`/`getDeck` return only that member's
  rows. A card can still be private to one member (`cards.private_to`, their
  reinforcement cards).
- **Deleting a member** removes everything that is theirs — decks, cards and
  history — in one transaction.
- **Sign-in** is throttled per username (8 wrong passwords lock it for ten
  minutes), and an unknown username takes as long to reject as a wrong password.
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
- **Streak**: one "active day" per calendar day with ≥1 completed exercise.
- **Days are the member's own.** Every timestamp is stored in UTC; what is
  personal is where a day *begins*. The browser reports its time zone once
  (`PUT /api/settings { timezone }`), and the streak, the daily goal and the
  study budget roll over at that member's midnight (`services/clock.ts`). With
  no zone stored a day is a UTC day.
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

**19 professions** in four groups:

| Group | Professions |
| --- | --- |
| Gathering | Mining, Woodcutting, Fishing, Farming |
| Artisan | Smithing, Cooking, Herblore, Fletching, Runecrafting, Jewelcrafting, Leatherworking, Tailoring |
| Support | Enchanting, Thieving, Agility |
| Combat | Attack, Strength, Ranged, Magic |

**Materials & chains** (59 items) — gathering produces raw goods, artisans refine
them, combat consumes gear. Enchanting is the second-order artisan: it binds cut gems
(Jewelcrafting) and runes (Runecrafting) into amulets, robes and blessed blades for Magic:

```
Mining ──ores/essence──► Smithing ──bars──► weapons & armour ──► Attack/Strength
  └────► Runecrafting ──runes──► Magic
Woodcutting ──logs──► Fletching ──bows + arrows──► Ranged
Fishing ──fish──► Cooking ──food──► combat
Farming ──herbs──► Herblore ──potions──► combat
Thieving ──gems──► Jewelcrafting ──vials──► Herblore ; ──leather──► armour
combat drops ──hides/bones/gems──► Jewelcrafting
```

**Recipes can gate on a second profession.** An action's `requires` is a list, so a
tier-4 bar needs both the Smithing level *and* the Mining level that fed it, and a super
attack potion needs Herblore *and* Farming. The result is a web, not a row: to reach
tier 5 you train two professions, and each one's output is the other's input.

**The level lives on the action, not the profession.** Every action has its own
XP pool and its own level, and its own passive that grows with *that* action:
gathering +1% **of the action's own output**/level (`Mine copper` gives more
copper, `Mine essence` more essence — not more of everything), artisans +0.5%
bonus-product chance/level, Agility +0.5% **XP to every profession**/level, combat
+1% power/level, Thieving +2% coins/level.

**The curve ramps up.** One action level costs `50 + ⌊(level − 1)² / 4⌋` XP: the
first levels are minutes of a run, level 60 costs ≈920 XP, and maxing one action is
≈84.6k XP (a 4-action profession ≈338k). **Early levels are quick, the late climb
is steep**, and a live rig also earns XP on its own (§13.5.1). Level 100 is a long
goal, not an impossible one.

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
of all 19 professions, out of 100 — a percent-complete figure, 1 at the start and
100 when every action is maxed. It is *derived*, never stored: drills and the idle
rigs both feed the professions underneath it, and shipping a new profession (or a
new action inside one) lowers it until that content is trained. Nothing levels the
account directly — the review XP ledger drives the daily goal and the streak, not
this number. `accountLevel()` in `apps/server/src/services/board.ts` computes it on read.

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
  level; Magic's *Arcane Study* feeds Enchanting, and so on for all 19. `Mod`
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

**Equipment & combat:** the paper doll has 13 slots — head, neck, chest, waist,
legs, feet, hands, ring 1, ring 2, trinket 1, trinket 2, main hand and off hand.
Rings and trinkets share a slot family, so any ring fits either finger. Smithing
forges plate weapons and armour for melee, Leatherworking makes leather for ranged,
Tailoring weaves cloth for magic, and Jewelcrafting/Enchanting make jewellery. A fight
uses **whatever you have equipped** — you never pick a weapon or a skill. The
equipped main-hand's tag decides the combat profession the fight trains: a melee
weapon (sword) trains **Strength**, a bow trains **Ranged**, a staff trains
**Magic**, and bare hands are still melee (Strength). `actionState()` reports
`locked / affordable / equipOk` for every profession-board action (those still gate
on gear).

**Crafted gear always comes out the same.** Every craftable piece is an *instance*,
not a stack: the recipe produces one piece with the fixed stats in
`game/skills/items.data.ts`, so two bronze swords are interchangeable. Jewelcrafting
and Enchanting are what change a piece — cut gems in jewellery and enchantments bound
to a slot are the only source of variation. A piece carries
`strength`, `agility`, `intellect`, `stamina`, `haste`, `crit` and `mastery`:

- **Primaries** (Strength/Agility/Intellect) scale the combat style the piece is
  built for: melee → Strength, ranged → Agility, magic → Intellect. They add to
  `playerPower` at half weight.
- **Stamina** adds raw HP (`+3 HP` per point).
- **Haste**, **Crit** and **Mastery** are rating-style: diminishing curves convert
  them to percentages. Crit multiplies a landed hit, Haste can grant a second
  strike, and Mastery boosts the weapon's own style damage.

The **Inventory** screen shows the paper doll and saved loadouts; the **Bank**
screen holds materials and consumables. The Inventory screen shows every crafted
piece, its stats and its gear score, and lets you save named **gear sets**
(loadouts) for quick swapping between melee, ranged and magic. A set snapshots the
slot → instance map; applying it swaps the whole loadout in one click. Equipping
an instance keeps its stats. **Instances are the only record of owned
equipment**: an item's count in the bank is the number of its instances, worn
ones included, and the `inventory` table holds materials only. A recipe, a rig
or a drill can spend only *spare* pieces — what you are wearing is never
consumed.

**Set bonuses and salvage.** Wearing 2, 4 or 6 pieces of the same armour family
unlocks a set bonus: Vanguard (plate) grants armour, crit and power; Trailblazer
(leather) grants haste, crit and power; Arcanist (cloth) grants mastery, haste and
power; Jeweler's (jewellery) grants stamina and crit. The Inventory screen shows
each set's current pieces, active tiers and the next tier. A piece you do not
need can be **salvaged** back into its material instead of being discarded. Past a
band's gear-unlock point the salvage also yields that band's **reagent**
(§13.5.3) — the feedstock Enchanting spends to improve higher-tier gear.

**Equipment requirements.** Gear is gated by combat stats, RuneScape-style:
weapons need the skill they train (melee → Attack, bow → Ranged, staff → Magic),
and quivers/tomes/orbs need their own style. Armour and shields need Strength —
their defence comes from the piece's own armour stat. Rings, necks and trinkets
are not gated. The level scales with the item's tier: bronze 1, iron 5,
steel 10, mythril 20, adamant 30. A crafter stays a step ahead of the combat gate,
so a smith can forge adamant long before they can wear it. The Inventory screen
shows each piece's requirement and greys out its Equip button until the player
qualifies; applying a saved set skips locked pieces and reports them instead of
failing the whole swap.

**Fights (active, language-driven):** 6 monsters with HP, damage and drop tables.
Any monster can be fought with any gear — difficulty is its HP and damage, not a
gate. Monsters are **fixed** — their numbers never move — so the buffs a player
stacks (§13.5.3) read as *power*, not as a modifier that quietly cancels itself
out. Progression is a **ladder**: you climb to higher monsters and bosses, the
buffs are what make the next rung winnable, and the top rung is tuned against a
fully stacked player. Combat drills are **review only**: a fight never
introduces a new card, it drills cards that already have a spaced-repetition state
(due ones first). Drills run as a **time attack**: the first drill waits for a
Start click, then each drill gets 20 seconds and the next drill's clock starts as
soon as the previous exchange resolves. A timeout counts as a miss. **The monster
lands a blow on every exchange** — whether you strike it, miss, or run out of time
— for `monster.damage − armour` (min 1). A drill you answer **correctly** also lands your own hit for
`playerPower = (3 + skillLevel*1.5 + weaponPower + primary*0.5) * (1 + damageBonus + mastery)`,
multiplied by a crit and possibly a haste strike. Your HP is
`20 + hpBonus*20 + armour*2 + stamina*3` and **carries between
fights**; **only food and potions heal it** — there is no passive regeneration, and
a defeat leaves you at 1 HP rather than a free heal. **Win** → drops + combat XP
(credited to the trained profession) + overall XP;
**lose** → the fight ends with nothing. One active encounter per player
(`encounters` table). Events: `combat.hit`, `combat.ended`.

**Auto-consumables:** food (`cooked_shrimp`/`trout`/`lobster` heal 4/8/14) and
potions (`attack_potion` +25% power, `restore_potion` +25% max HP). A potion is
**auto-drunk at the start of a fight**; the best food in your bank is **auto-eaten
whenever HP drops below the threshold** (default 50%, a per-user setting). Monsters
are balanced around you bringing food — without it the harder fights are a straight
race you'll lose. Grading an action also validates unlock + affordability, so
material costs can't be bypassed by calling the grader directly. And a grade is
only taken for a drill the server **handed to that member** (the card and the
exercise both, `routes/practice/issued.ts`): practice and combat cannot be
farmed by posting the easiest exercise for a known card.

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
   complete 1 drill          complete 10 more             come back later
   ─────────────────         ─────────────────            ──────────────
   +1 ore  (the strike)      +1 ore  (the strike)         bank is full
   run: 1 / 19s for 10 min   run: 1 / 15s for 1h 20m      pick new drills
```

**Nothing ticks.** There is no scheduler, no worker, no timer. A run is *not* a
loop that runs every second — it is a **function of recorded facts and the clock**.
Per `(user, action)` the database keeps only what a completion already tells us:

| stored | meaning |
| --- | --- |
| `completions` | how many drills this action has ever completed — drives rate & length |
| `run_ends_at` | when the current run expires (ms; `0` = still) |
| `run_started_at` | when the current run began (`0` = unknown) — the "gathered this run" origin |
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
**10-second ceiling** (the default cap; talents will lower it), and **25 completions
buy the full 3 hours** — every completion before that adds the same slice of time.

```
intervalSeconds(c, tier) = tierFactor(tier) · (10 + 10 · 2^(−c/10))  // 20s → 10s per item
runSeconds(c)            = 600 + (10800 − 600) · min(c−1, 24)/24     // 10 min → 3 h at c=25
tierFactor(tier)         = 1 + 0.35·(tier − 1)                       // tier 1 ×1 … tier 5 ×2.4
xpPerCraft               = 0.9                                       // action XP per completed craft
```

**A live run earns XP too.** A drill hands over the action's `xp`; while a run is
alive the rig also pays `IDLE.xpPerCraft` for **every craft it completes on its
own** (a gathering rig every item, an artisan every transformation), credited
through the same `awardActionXp` path so talent XP bonuses apply. So a machine
left running levels its profession the same way drilling does, just by the clock —
that is what makes "leave it running and come back" pay in levels, not only in ore.
`settleAll` accrues it in the same closed-form pass as the items (a completion
count already *is* the craft count, so nothing new is stored), and the action XP
curve was raised and steepened for the idle era (see §13.5: ~84.6k XP to cap an
action). `xpPerCraft` is `0.9`, so a full 3-hour maxed run pays ~0.95k XP — enough
that the machines carry most of the leveling, but capping an action takes ~89 such
runs rather than a couple. At one maxed tier-1 rig that puts level 60 around **60
hours**, and level 100 around 260, with talent XP bonuses meant to shorten the climb
later.

**Tier slows the rig, not the run.** Higher-tier actions run proportionally slower
per item (`tierFactor`) but keep the same run length, so deep content (adamant,
yew, blessed blades) stays *rarer* without costing you more real time — the run
window is about how long you can be away, and that is the same for everyone. The
table below is tier 1; multiply the interval by `tierFactor` for deeper rigs.

**A drill tops the run up, it does not refill it.** Each completion **adds one
equal step** to the run you already have (`extendRig` adds `rigRunSec / 24` — the
first drill starts the 10-minute run, every drill after adds the same slice). A
steady chain therefore climbs `10 min → 3 h` by the 25th completion, but a rig you
let drain is only topped up by that one step: drilling a long-lived rig with 20
minutes left buys ~27 minutes, not another night. The end is clamped to `now + maxRunSec`,
so the run can never exceed the ceiling however fast you drill, and `settleRig`
re-clamps on every read. (Basing the run on a lifetime count instead — setting the
end outright to `rigRunSec(completions)` — meant any single drill snapped a
drained rig all the way back to its ceiling, which is what a "top up" must not do.)

| completions | 1 | 10 | 25 | 50 | 100 | 300 |
| --- | --- | --- | --- | --- | --- | --- |
| one item every | 19.3s | 15.0s | 11.8s | 10.3s | 10.0s | 10.0s |
| a run lasts | 10m | 1.2h | 3h | 3h | 3h | 3h |
| items per run | 31 | 295 | 918 | 1,047 | 1,079 | 1,080 |
| XP per run | 28 | 265 | 826 | 942 | 971 | 972 |

**The fill is visible.** A rig's view carries how **full** the run is —
`runProgress` (0 → 1, the run's remaining time against the 3-hour cap) and a
`maxed` flag once the run has actually reached that cap. So the practice result
draws a bar that fills as you top the run up and, while it is short of 3 h, names
the time still to add; only a full run reads "maxed" and points the next drills at
a different action. `runSec` is the run a steady chain has *climbed* to at that
completion count (not a promise after a drain), and `secondsLeft` is the run the
drill actually leaves, so the "left" it reports always matches the home screen.
The profession page shows the same fill per action, so the board is where you
decide what to power next.

**Every action is a rig**, including the artisans. A gathering rig makes something
from nothing; an artisan rig *transforms* — its run consumes the recipe inputs and
produces the outputs, clamped by what the bank holds at settle time. You point your
effort by choosing which action's drills to do: drill `Smelt bronze` and your smelter
runs; drill `Forge iron sword` and your forge runs. Raw materials are effectively
free now, so the game's real currencies are **time** (run length), **attention**
(which rigs you power) and **XP** (levels). XP is no longer drill-only: a run pays
it as it works, so *which rigs you keep alive* is a leveling decision too.

**Only a couple of machines run at once.** You may keep `MAX_LIVE_RIGS` (**2**) runs
alive at a time. Drilling a third action starts its own machine and, when every slot
is full, **stops the run closest to finishing** — the machine that was about to stop
anyway, so the least real time is thrown away. Nothing else is lost: the drill still
lands its strike and logs the completion. To swap on purpose, a live rig can be
**cancelled** from its row (confirmed first): it settles up to now and falls still,
freeing the slot for the action you would rather run. This cap is what makes the
idler study-friendly: with only two machines to tend there is no third, fourth or
sixty-seventh rig to keep alive, so nothing is gained by drilling non-stop — you
power the two you want and leave them running.

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
*meant* to leave a 3-hour run going and come back. So the pace is set by how long the
supply rigs must run — a few hours for starter gear, and **roughly a whole day for
the deep gear**, which is seven or eight "leave it running" sessions spread across days
of study.

The budget is legible, not vibes: an action needs `⌈84575 / xp⌉` drills to reach 100
*if you only drill* — but a live rig also pays `xpPerCraft` per item, so the levels
come from the machines too (a full 3-hour run of a maxed rig is ~0.95k XP, about a
ninetieth of a cap). Material costs are chosen so the **scarcest raw material** it
consumes works out to the tier's target. Refinement is deliberately the *cheap,
fast* feeder layer (a bar costs 2 ore); the **goal** actions carry the time.

| action → Lv 100 | tier | drills | before | now | ~rig time |
| --- | --- | --- | --- | --- | --- |
| fletch an oak shortbow | 1 | 705 | 1 log | **12 logs** | 4h |
| forge a bronze sword | 2 | 705 | 1 bar | **12 bars** | 8h |
| fletch a willow longbow | 2 | 471 | 1 log | **24 logs** | 7h |
| make a leather body | 2 | 605 | 3 leather | **14 leather** | 8h |
| forge an iron sword | 3 | 471 | 2 bars | **20 bars** | 12h |
| forge steel leggings | 3 | 385 | 3 bars | **20 bars** | 13h |
| string a sapphire amulet | 3 | 385 | 1 gem | **24 gems** | 12h |
| forge a steel platebody | 4 | 282 | 3 bars | **40 bars** | 18h |
| forge a mythril sword | 4 | 265 | 2 bars | **30 bars** | 19h |
| fletch a yew longbow | 4 | 282 | 2 logs | **48 logs** | 13h |
| forge an adamant platebody | 5 | 193 | 3 bars | **38 bars** | 24h |

(The `drills` column is the **drill-only** count at the steeper curve — a live rig pays
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
substitute for studying: you have to drill to **start** the machines, and the steep
action XP curve keeps passive income sharpening the loop instead of replacing it.
The runs reward *coming back*; the drills remain the reason to open the app.

### 13.5.2 Rig alerts — a nudge before the machine stops

A run that expires silently is wasted time: the player has to drill again to keep
the machine alive. So when a run drops **under 30 minutes**, the app sends one
notification — "Mine copper is running low — 22 minutes left — drill to keep it
going" — with a tap that opens Home. The alert is a *come back and drill* nudge, not
a completion receipt. It only fires for runs that have grown **past an hour**, so a
young rig never nags while you are still drilling it up; shorter runs are ignored,
because there is little to extend yet. The gate reads the run's **own length**
(`run_ends_at - run_started_at`), not the lifetime completion curve, so a veteran
who drains a rig and starts a fresh short run stays quiet as well — `rigRunSec`
only paces the run, it no longer describes one that was topped up from a drain.

**Two paths, one switch.** The server pushes through the browser's push service, so
the alert arrives with the app closed. While the app is open, a local timer arms the
same moment from `/api/rigs` (a pure read — no settle) and shows the notification
from the page. The service worker suppresses the server copy when a window is
focused and the page suppresses its timer when it is not, so the two paths never
double-notify. The switch is **per device**: turning it on for the phone leaves the
laptop quiet. It lives in Settings → Rig alerts, and each device grants its own
notification permission.

**Nothing polls the rigs.** The server scan is one indexed query a minute
(`run_ends_at` within the lead, `notified_ends_at` not already this deadline); the
`notified_ends_at` column records the deadline that was announced, so a restart or a
second scan stays quiet, and a drill that extends the run re-arms it. The client
polls `/api/rigs` only while alerts are on. There is still no per-rig timer on the
server — the scan is a read, not a settle.

**No new dependency.** Payload encryption is RFC 8291 (`aes128gcm`: ECDH P-256 →
HKDF → AES-GCM) and authorization is RFC 8292 VAPID (ES256), both on WebCrypto. The
VAPID keypair is generated lazily and kept in the `settings` table; devices live in
`push_subscriptions` (one row per installed PWA, keyed by endpoint). A device has
one owner: when another member enables alerts in the same browser it becomes
theirs. A revoked
subscription answers 410 and its row is dropped. The VAPID contact defaults to
`mailto:push@localhost` and can be set with `TUTOR_PUSH_SUBJECT`.

**Platform limits.** Android Chrome and desktop browsers need the app installed
(or at least a permission grant) and a secure context; iOS 16.4+ only delivers push
to a PWA installed on the home screen. A closed browser that never granted
permission cannot be reached by any web API — that is the one case the local timer
covers only while the app is open.

### 13.5.3 Tier bands, tier buffs & reagents

Gear runs along a **material axis** — bronze → iron → steel → mythril → adamant —
and each material is a **tier band**, not a skill per item. A band owns **one**
level track: its recipes unlock at thresholds *inside* the band, so Bronze is a
single progress bar (bars at 1, boots at 6, plate at 12, …), shown on the actions
page as a **dropdown** that expands to the whole bronze set. Making any bronze
item feeds the same bronze score — you never level a dozen near-identical actions
to move on.

**All of a band's gear unlocks by ~level 40; the band still runs to 100.** The
front half (1–40) hands out the tier's equipment. The back half (40–100) is why the
tier stays worth playing forever, and it pays out two things:

- **A per-level buff for the whole account.** Each material grants one *distinct*,
  *additive* stat per band level — bronze **crit**, iron **lifesteal**, steel
  **haste**, … — so more bronze levels mean more crit, full stop. The **level cap
  is the ceiling**: `+0.2% crit/level` makes bronze 100 a finite `+20%`. Bands
  stack, and the stacking is the point; the sum over five bands is finite and
  tunable because nothing re-levels the monsters to cancel it (§13.5).
- **The band's reagent.** Smelting down the band's gear yields a **bronze / iron /
  … reagent**, and **Enchanting** spends it to apply that band's signature buff to
  *any higher-tier piece*. Each band's reagent is a *different* effect, so a build
  wants a mix and the deepest reagent you can farm is not automatically the only one
  worth farming.

**The loop closes and no tier goes dead.** Level bronze to 40 → unlock bronze gear
→ keep going to 60/80/100 → more crit and bronze reagent → enchant iron gear (new
gear needs re-enchanting, so reagents stay in demand) → iron gear farms iron
reagent faster → enchant steel. A deep tier's *gear* is superseded, but its
**passive** and its **reagent** keep paying into every tier above it.

**More material, more reward.** A deeper item in a band costs more material but
awards proportionally more XP and coins — **~10% more per material** over the item
below it — so the deepest thing you can afford is always the most rewarding thing
to make, and the climb *accelerates* into the next band's unlock instead of
slogging through it.

This supersedes the per-item action level for gear tiers: the mean-of-actions
readout (§13.5) still scores professions whose content is not a material band, but
a smith's bronze score is **one** track, not seven. (The mined `essence` item is
unaffected; a band **reagent** is a distinct, crafted feedstock.)

### 13.5.3.1 Prospecting & gem-binding (Jewellery)

Gems do not fall out of the ground — they are **prospected** out of ore. A gem's
**type is its stat**, the same at every tier (ruby always crit, emerald always haste,
sapphire always mastery); a gem's **tier is the ore** it came from — cracked (copper),
chipped (iron), perfect (mythril/adamant). One ore drops any type of its tier.

`Prospect ore` is **one action**: pick which ore you hold to crush, and its tier
decides the table of rough gems. The ore is **always spent**; a rough gem only appears
at that ore's odds (40–55%, `+3%/level`, capped at 100%), so a miss is a real cost and
a skilled prospector wastes less. The same odds fold into an idle rig's rate. Because
it is one action, *every* ore you prospect raises the **same** level.

The gems then flow: `Cut … gems` is **one action per tier** (pick any rough gem of the
tier), and the cut gem has three uses — **set** it into a metal band (Smithing's
`forge-*-band` + the gem → a ring whose stat is the gem's type), **craft** it into
better jewellery, or **crush** it to **dust** for Enchanting. Dust is the gem-side
enchant currency: it stamps that gem's stat onto any crafted piece, alongside the
band reagents that stamp a band's signature stat. Both halves run on the tier bands
every artisan shares (§13.5.3).

### 13.5.3.2 Distillation & enchants (Enchanting)

Enchanting has **one** track: `Distill`. You pick an item from your inventory, burn it,
and learn from it — XP tracks the item's **coin value** only loosely
(`DISTILL_XP_PER_VALUE`, 0.2 XP per coin): a raw ore pays **1 XP** and a bronze sword
**4**, so better gear is worth more without an endgame piece leveling Enchanting in a
few clicks. Distilling also yields the item's **family essence** (metal, cloth, leather,
wood or gem), the reagent every enchant is built from. Burning is the point: Distill is
the sink that eats surplus materials and gear.

Distill runs as a **rig like every other action**, but its recipe is not fixed in the
data: you stock it with a **per-member policy**. In the Bank you tap items to mark them
distillable, and the Distill panel picks the order — **highest value first** or **lowest
value first**. The rig then transforms marked stock, one item per craft, into that item's
family essence and the value-scaled XP, clamped by the bank: it stops when the marked
items run out. Because it only burns what you marked, it can never run away, and the drill
still pays the action's flat XP on top.

**Enchants** are catalogued **by slot** (`ENCHANTS`) and unlocked at Enchanting levels
— all chest enchants sit together, so you unlock +stamina at Lv 3 and +strength at Lv
5. Every enchantable slot (head, neck, chest, waist, legs, feet, hands, main hand, off
hand, rings, trinkets) carries a menu of stats running from Lv 2 up to Lv 50, and the
stat points scale with the level, so Distill keeps having a reason to climb.

Applying an enchant spends three things: the piece's **family essence** (the Distill
output, scaled by level), a **tier of profession material** and a **tier of combat
reagent**. The tiers step every ten Enchanting levels — copper ore + slime goo, then
iron + wolf fang, coal + bone shard, mythril + imp ember, adamant + dragon scale — so
the deeper your enchants, the more Mining (and the other gatherers) and the tougher
monsters you must farm. The combat reagents are monster drops (`slime_goo`,
`wolf_fang`, `bone_shard`, `imp_ember`, `dragon_scale`), which is what gives fighting
a purpose beyond XP.

Enchanting is **enchant-first**: on the Enchanting page you tap a recipe, and the game
offers the pieces you already keep in that slot — the ones saved in your loadouts, or
what you are wearing when you have no loadout. Applying one fits the piece's slot,
needs its level and its reagents, and grants **no XP**: the training is Distill, the
enchant is the payoff. An enchant adds its stat points straight onto the piece (one per
piece, replaceable), so it flows through the normal gear maths.

## 13.6 Spaced repetition (FSRS-6, Anki-style) & guided curriculum

Scheduling uses **FSRS-6** — the algorithm Anki 25.07+ uses — through the
reference TypeScript implementation (`ts-fsrs`, FSRS-6 model) with Anki's
**default 21 weights** (`w20 = 0.1542` trainable decay), configurable
**learning steps** (default `1, 10` minutes — Anki's default, so a brand-new card
is answered, comes back once, then graduates) and **relearning steps** (`10m`), and
intervals derived from a **desired retention** (default `0.9`, per-user). An
Anki-style **daily budget** — new cards/day and reviews/day (default 20 / 200),
with a "study more" override — bounds how much a day *asks* for; practice treats
it as a soft goal and keeps serving what the deck still has (below). The state
machine around the memory math — steps, due dates, card selection, curriculum
graduation — is ours (`apps/server/src/game/srs.ts`).

```
   rating  ──┐
  (Again/Hard/Good/Easy)        memory state (per card, per user)
             │        ┌────────────────────────────────────────────┐
   ┌─────────▼──────┐ │  state: new→learning→review↔relearning     │
   │   FSRS-6 core  │ │  stability S, difficulty D, step, reps,    │
   │  schedule()    │ │  lapses, intervalDays, dueAt, lastRating   │
   └─────────┬──────┘ └────────────────────────────────────────────┘
             │
   dueAt + intervalDays ──► selectStudyCardId() (overdue → new → done)
```

- **A sitting opens on a few new words.** `selectStudyCardId()` puts the due backlog
  first, which is right in the middle of a sitting but feels like grinding at the
  start. So practice warms up: while fewer than **3 cards have been graded in the
  last 30 minutes** (i.e. the sitting is young), the next card is a new one —
  round-robin across decks when none is focused; then the due/hardest-overdue card
  takes over. A pause longer
  than 30 minutes starts a new sitting, so it warms up again. The warm-up never
  overrides the daily budget and never invents a card: with no new words left it
  falls straight through to the review queue. Combat is unaffected — it is
  review-only by design (`pickReviewCard`).
- **A lesson picks the path, not a card pool.** Starting the next step of the
  frequency path drills the **whole deck** (due → new → done), not just that
  step's cards. A one-word step has nothing else in it, so a lesson-scoped queue
  used to re-show the same word four or five times while its learning steps
  waited. Now the queue moves on to the path's next new word
  and the learned one comes back only when its step is actually due. The practice
  header follows the card on screen (`POST /api/practice/next` returns its
  `lessonId`), and lesson completion fires only on the transition, not every time
  an already-finished lesson is reviewed. `POST /api/practice/next` also takes an
  optional `cardId` for a targeted drill; the daily budget still applies.
- **Practice never serves a card ahead of its due date.** When the due backlog is
  empty and no new word is left, the day is **done** — the queue returns nothing
  rather than the soonest scheduled card. Reaching past a review card's due date
  looked harmless but was a trap: a same-day review of a card that is not yet due
  leaves the due date untouched (`schedule`), so the "soonest card" fallback handed
  back the very same card forever (the "This is not that." loop). Combat keeps
  `selectCardId`, whose fallback gives every hit a card to fight with: when
  nothing is due it serves the card that has waited **longest since its last
  review**, so a fight rotates through the deck instead of drilling one card. A
  review card that **is** due is always rescheduled, even inside 24h of an early
  (combat) review — otherwise it stayed due however often it was answered — and a
  miss on it goes to relearning.
- **The daily budget is a goal, not a wall.** Hitting the day's new/review cap does
  not stop practice while the deck still has something to give: the next `next`
  call raises today's allowance for the kind that is blocked and serves the card,
  so a motivated learner keeps getting new words instead of an early "done". The
  header stays honest — `newRemaining` climbs by one each time. "Done" now means
  the deck itself is finished (nothing due, no new words), and "study more"
  remains for a targeted drill that the budget is holding back.

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

## 13.7 The path deck, n+1 sentences & auto-growth

A **path** is the default way to learn here: the learner picks a language and the
app builds the deck for them — there is no prompt to write. `POST /api/decks`
with `kind: "path"` (`srv/routes/decks/create.ts`, `srv/deck/path.ts`) fetches a
real frequency list, puts the sentence-making words first (the curated
`text/lexicon.ts` Mandarin and `text/frequency-ja.ts` Japanese lists are the
prefix; every other language starts from its frequency list), and asks the
generator for the first **10** words (`pathInstruction`).

Each batch is a small card set: a **vocab** card per word, a **sentence** card
that uses it (n+1, below) and, once the known words allow, a **grammar** card —
a fill-in-the-blank the learner completes with one word (`grammar_cloze`). A word
that is itself a grammar point takes its grammar card in place of a vocab card
(§10). The prompt asks for tokens and distractors on every sentence and single-word options
on every blank, so the batch plays as Duolingo-style tiles and choices, not only
typing. The full word order is computed once and stored in the deck's settings,
so the path is deterministic and the register is everyday, spoken, manga/manhwa/
manhua `pathInstruction` — never exam language.

**It grows itself.** When a member has seen all but **3** of the deck's cards,
`srv/deck/autoGrow.ts` (`maybeAutoGrow`, fired from the review path) starts a
background build of the next 10 words with the same instruction and the words
the member now knows. The deck is therefore *tailored as it is studied*: a learner
who is quick gets new words sooner, and each batch continues from what they have
met. `POST /api/decks/:id/grow` with `all: true` still builds every remaining
word at once for someone who wants the whole path ready.

**A deck fills one batch at a time.** `srv/deck/builds.ts` marks a deck busy from
the first fill of a creation until that fill ends, and the grow route claims the
deck before it awaits anything else, so a second growth, a clicked grow or the
auto-grow check sees the deck busy and waits instead of planning the same words
again. `persistOne` is the last line of defence: it refuses a second card with
the same template and text in a deck, so a word the generator repeats can never
become a duplicate "new" card.

**Every card is reviewed before it is saved.** After the generator returns a
batch, `srv/deck/review.ts` runs it past the judge model: each card is checked for
a correct meaning, grammatical and natural target text and a correct reading, and
is kept, fixed (a wrong reading or meaning) or dropped. It is the card-side twin
of grading each recorded clip before it is stored (§9.2); the deterministic
`verifyCard` drills run on top of it.

**The word list lives in a dictionary, not in the deck.** Each language has a
lexicon at `$TUTOR_DATA_DIR/lexicon/<lang>.json` — `{ "<word>": { rank, reading,
meaning } }` — built once by `scripts/build-lexicon.ts` (`srv/deck/lexicon.ts`
reads it, `srv/deck/lexiconBuild.ts` builds it). The rank *is* the path order: the
curated seed, then the words harvested from the decks we already had, then the
frequency list. The reading and meaning come from those same decks and the
curated lists, and the model fills the meanings still missing, in rank order. A
path deck then stores only its `cursor` into that order, so the words are written
down once and every lookup is a map access: the planner is handed the correct
reading and meaning as `hints` (§10.3) and growth reads the order straight from
the lexicon. A deck imported from Anki, which brings its own words, keeps them in
its settings.

The path itself walks **one word per step**, so a step can only ever introduce a
single new thing:

```
我 → 你 → 是 → 不 → 好 → 很 → …                (frequency order)
   step 1   step 2  step 3   …                 each step = 1 new word
```

The Learn tab is deliberately minimal: pick a language, tap **Start my path**.
The lesson list is gone — the path advances one step at a time and extends itself.

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
  pinyin by a mechanical converter (`text/zhuyin.ts`), e.g. 學生 = ㄒㄩㄝˊ ˙ㄕㄥ.
- Japanese → **furigana**, i.e. the kana split into ruby segments over the kanji
  (`text/furigana.ts`): 食べる → 食[た]べる, お茶 → お茶[ちゃ].

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

A path belongs to one member; how you *drill* it is personal. `services/study.ts` keeps
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
- **Learning steps** — `learningSteps` (default `1, 10` minutes, Anki's default).
  These decide how many times a brand-new card repeats before it graduates: it is
  answered, comes back once, then graduates, so it is done for that first day.
- **Auto-reinforce** — `autoReinforce` (default on). When a card reaches
  `REINFORCE_LAPSES` lapses, `deck/reinforce.ts` asks the planner for one extra
  sentence/grammar card that practises the same word using only words already met
  (n+1), and adds it to that word's lesson (`payload.reinforces = <cardId>`).
  The card is **private to that member** (`cards.private_to`): the deck is theirs,
  and it grows only where they need it.
  One reinforcement per card and member; a failed attempt is retried a day later. `POST /api/decks/:id/cards` is the same insertion path for a
  hand-authored card: a `step` places it in that lesson, no `step` appends a new
  one.

- **Studying deck** — `activeDeckId` names one deck to focus: Learn leads with it
  and a request that names no deck defaults to it. **All decks** (the default,
  unset) is the opposite: `POST /api/practice/next` then serves every deck. Due
  reviews still come first (soonest-due across all of them); when it reaches new
  words it takes them **one deck at a time, round-robin**, so all three advance
  evenly instead of the first deck draining the day's new budget. Both the sidebar
  **Studying** picker and the Practice deck picker offer it.

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
5. **Settings** — languages, **per-role model picker** (§10.1), speech
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
path on mobile for a beginner who has not enabled a CJK keyboard. For *free*
typing there is now a built-in IME (§14.3).

### 14.3 The built-in IME — one keyboard per card language, no OS switching

Since a page still cannot switch the OS keyboard, the app brings its **own**.
When the exercise's answer language has an engine, the answer field is driven by
an on-screen keyboard and a candidate bar; the engine is derived from the card
(`answerLang`), so it *is* the switch the OS refuses to make — Korean card, Korean
keyboard, automatically.

- **Engines are pure TypeScript** (`apps/web/src/lib/ime/`): `hangul` (2-beolsik
  jamo composition — what libhangul does), `kana` (romaji→kana, mozc's romaji
  mode), `bopomofo` (Taiwanese Mandarin Zhuyin) and `latin` (a plain QWERTY for
  English and the other latin-script languages). `imeFor(lang, { variant })` picks
  one, so a new language is a new engine file plus a registry line — the same
  extensibility promise as exercises.
- **The keyboard is a Gboard-style bottom sheet**: full width, sitting on the
  bottom edge with a hide button. Keys sit on a fixed column grid so they are the
  same width in every row; the third row carries shift and backspace, and shift
  reveals the doubled Korean jamo (ㅃㅉㄸㄲㅆㅒㅖ) instead of a fourth row. While it
  is open it reserves the same height under the page, so the whole card scrolls
  above it; hiding it scrolls the page back to the bottom. **Enter commits first,
  then submits**: while a preedit or candidate bar is open it commits the
  composition, otherwise it submits the surrounding form — the on-screen key and a
  hardware Enter do the same thing. The enter key vibrates like the rest, and
  submitting closes the sheet at once instead of waiting for the grade reply, so
  the next screen is seen whole; after it closes a one-second tap guard
  (`lib/tapGuard.svelte.ts`) swallows stray taps while the bottom tab bar is
  uncovered.
- **The space bar is the first tone.** On the Chinese keyboard space enters the
  **first tone** (一聲, `ˉ`) instead of a space — Mandarin has none — so Enter is
  the commit key there. The other engines keep space as a space.
- **Numbers and punctuation live on a second page.** A `?123` key swaps the
  letter rows for a symbols page — numbers across the top, then that language's
  marks (Chinese `，。、？！`, Japanese `、。？！`, Korean and the latin scripts
  `.,?!¿¡`) — and a key labelled with the script (`ㄅㄆ`, `かな`, `한글`, `ABC`)
  swaps back. Tapping a mark commits the open composition and appends it, and a
  mark typed on a hardware keyboard does the same.
- **Conversion candidates come from the server** (`POST /api/ime/candidates`,
  `apps/server/src/ime/candidates.ts`). The gateway already holds the
  dictionaries, so the Mac does the heavy part: a reverse index of the MOE
  Zhuyin readings → Traditional words (Taiwanese Mandarin, the rime role) and of
  the Kanjium kana → kanji (the mozc role). The whole composition is **segmented**
  against those indexes, so the first candidate is a whole-sentence conversion
  (ㄨㄛˇ ㄏㄣˇ ㄏㄠˇ → 我很好, わたしは → 私は) and a Japanese particle does not
  stop the suggestions. **Tones are optional**: a toneless reading is split into
  syllables by the Zhuyin grammar, so ㄨㄛㄏㄣㄏㄠ converts too. Candidates are
  ranked by the curated frequency lists (`text/lexicon.ts`,
  `text/frequency-ja.ts`) and the deck's own lexicon.
- **Why not bundle librime/mozc as WASM.** mozc has no browser build, librime's
  WASM port needs a multi-MB schema the PWA would have to fetch, and libhangul
  composition is algorithmic anyway. The app's own dictionaries are already
  Taiwan-standard and already on the server, so the same behaviour costs no new
  asset and no client bundle.
- **Not forced.** The keyboard opens by default on a touch device; *Use the
  system keyboard* hands the field back to the OS (and a small link brings it
  back). On a fine-pointer device it stays closed until asked for.
- **A physical keyboard converts too.** Each engine carries a `physical` keymap —
  2-beolsik for Korean, the standard Zhuyin layout for Chinese, romaji for
  Japanese — so typing on a hardware keyboard runs through the same engine with
  the on-screen keyboard hidden (the IME owns the field; the soft keyboard is
  optional). Keys the map does not know, and OS-IME composing keys, pass through.
- **Haptics.** Every key press vibrates at the member's chosen intensity
  (`lib/haptics.svelte.ts`); the Settings → Keyboard slider goes from Off (the
  lowest position) to Very strong. `navigator.vibrate` is Android-only, so iOS
  ignores it.

---

## 15. Nix flake design (dev + packaging)

### 15.1 Principles

- Flake provides **tools + the app build**; Python venv and models stay **on disk**
  (Metal can't run in the sandbox; weights are multi-GB and must be mutable/cached).
- One `nix develop` → everything for dev. One `nix run` → run the app locally.

### 15.2 The flake

`flake.nix` is the source of truth: the dev shell (bun, node, uv, python, ffmpeg,
just, sqlite, mkcert), `packages.default` (the `/tutor` build), `packages.root`
(the build that serves at `/`), `packages.speech` and the `fetch-models` app.

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
    Alternatively ship a prebuilt venv under `$TUTOR_DATA_DIR/python/.venv` created
    by `just setup`.
- **`justfile` targets**: `setup`, `dev`, `dev-web`, `models`, `speech`, `bench`,
  `gen`, `build`, `vad`, `test`, `check`, `lint`, `fmt`, `ci`, `knip`, `package`,
  `package-root`, `run`, `serve`, `certs`, `tailscale-{serve,unserve,cert}`,
  `caddy`, `service-{install,uninstall}`, `deploy`.

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
- Python deps are pinned in `python/uv.lock`; the model checkpoints are named in
  `python/speech/models.py` (their revisions are not pinned yet).

---

## 17. Observability

- Structured logs (JSON) with request IDs.
- Per-message token + `cost_usd` from OpenRouter usage; a dev "spend" panel.
- Speech metrics: cold-start ms, ASR latency, TTS first-packet ms, resident RSS,
  unload events (so we can tune the idle timeout).
- `just bench` script to print ASR latency, TTS RTF and peak RAM on this Mac.

---

## 18. Not built yet

- Streaming / barge-in voice, and a phoneme-level (GOP) pronunciation mode.
- Achievements, quests and leaderboards as event-bus subscribers (§11.4).
- A second speech provider (OpenRouter audio or whisper.cpp) behind the gateway.
- A retention policy for stored audio (today it is kept forever).
- Cloud sync / federation.

Known defects and refactors are tracked in [`BACKLOG.md`](BACKLOG.md).

---

## 19. References

- Whisper large-v3-turbo (MIT): https://huggingface.co/openai/whisper-large-v3-turbo
- VoxCPM2 (Apache-2.0): https://huggingface.co/openbmb/VoxCPM2
- Whisper / VoxCPM2 / the Qwen3 forced aligner in MLX (mlx-audio):
  https://github.com/Blaizzy/mlx-audio
- mlx-audio docs: https://neywa-labs.github.io/mlx-audio/
- MLX: https://opensource.apple.com/projects/mlx
- OpenRouter audio APIs: https://openrouter.ai/blog/announcements/announcing-audio-apis/
- OpenRouter multimodal audio guide:
  https://openrouter.ai/docs/guides/overview/multimodal/audio
- Selected models:
  - https://huggingface.co/mlx-community/whisper-large-v3-turbo-asr-fp16
  - https://huggingface.co/mlx-community/VoxCPM2-8bit
  - https://huggingface.co/mlx-community/Qwen3-ForcedAligner-0.6B-8bit
