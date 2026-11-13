# tutor

AI-first language learning. A local-first, Duolingo-like tutor where the **brain
is OpenRouter** (you pick the model) and the **speech is local Qwen3 on Apple
MLX** — no cloud speech, and the models free your RAM when idle.

- **Target:** Apple Silicon Mac as the server (16 GB tested), Android **PWA** as
  the primary client.
- **First languages:** Mandarin (HSK 1) and Japanese (JLPT N5).

Full design: [`docs/DESIGN.md`](docs/DESIGN.md).

## Quickstart

Requires [Nix](https://nixos.org/download) with flakes enabled.

```bash
nix develop          # bun + python3.12 + uv + ffmpeg + just
just setup           # install JS + Python deps
just models          # download the MLX checkpoints (~6 GB) into ./models
just dev             # start the API on http://127.0.0.1:4318
just speech          # (optional) run the speech gateway standalone
just bench           # (optional) measure latency + peak RAM
```

Open http://127.0.0.1:4318 — a placeholder page with a streaming chat box until
the SvelteKit PWA lands in Phase 3.

## API (Phase 2)

| Endpoint                                                                  | Purpose                                         |
| ------------------------------------------------------------------------- | ----------------------------------------------- |
| `GET /api/health`                                                         | server + speech status + active role models     |
| `GET /api/models?q=`                                                      | live OpenRouter catalogue for the model picker  |
| `GET/PUT /api/settings`                                                   | per-role model selection (persisted)            |
| `POST /api/chat`                                                          | streamed chat over SSE, persists both turns     |
| `POST /api/chat/json`                                                     | structured (JSON-schema) completion for graders |
| `GET/POST /api/sessions`, `GET /api/sessions/:id`                         | conversation history                            |
| `GET /api/speech/health` · `POST /api/speech/{tts,asr,align,wake,unload}` | speech, lazily started/stopped                  |

## Layout

```
apps/server    Bun + Hono API, SSE/WS, SQLite, PWA host, speech supervisor
apps/web       SvelteKit PWA (mobile-first) — Phase 3
packages/core  shared types, card + exercise registry contracts
packages/speech TS client for the speech gateway (provider interface)
packages/ui    shared Svelte components
python/speech  MLX speech gateway (Qwen3-ASR / ForcedAligner / Qwen3-TTS)
nix/           packaging + model-fetch wrappers
docs/          DESIGN.md (architecture + execution plan)
```

## Status

- [x] Phase 0 — scaffold, flake, tooling
- [x] Phase 1 — speech gateway (ASR/TTS/aligner + idle unload) — verified on M6
- [x] Phase 2 — backend (Hono, SQLite, OpenRouter, speech supervisor) — 17 tests green
- [ ] Phase 3 — SvelteKit PWA (chat + voice)
- [ ] Phase 4 — exercise engine + cards
- [ ] Phase 5 — pronunciation scoring
- [ ] Phase 6 — gamification
- [ ] Phase 7 — packaging + docs

## Configuration

Copy `.env.example` to `.env` (dev) or `~/.config/tutor/env` and set
`OPENROUTER_API_KEY`. Per-role model selection happens in the app UI.
