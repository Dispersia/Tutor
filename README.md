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

Open http://127.0.0.1:4318 — the SvelteKit PWA (sign up → chat or talk).

## API (Phase 2/3)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/register` · `/login` · `/logout` · `GET/PUT /api/auth/me` | accounts (first user is admin) |
| `GET /api/users` · `DELETE /api/users/:id` | admin: manage accounts |
| `GET /api/health` | server + speech status |
| `GET /api/models?q=` | live OpenRouter catalogue for the model picker |
| `GET/PUT /api/settings` | per-user roles + voice prefs |
| `PUT /api/settings/openrouter-key` | each user's own key (server key is a fallback) |
| `POST /api/chat` · `/api/chat/json` | streamed chat (SSE) + structured output |
| `GET/POST /api/sessions`, `GET /api/sessions/:id` | per-user history |
| `GET/POST /api/decks`, `GET /api/decks/:id/cards` | starter decks (HSK 1, JLPT N5) + AI-generated decks |
| `GET /api/exercises` | the exercise registry |
| `POST /api/practice/next` · `/api/practice/grade` | generate an exercise · grade it (+XP) |
| `GET /api/stats` | XP, level, streak |
| `GET /api/speech/health` · `POST /api/speech/{tts,asr,align,wake,unload}` | speech, lazily started/stopped |

Adding an exercise type takes a backend `ExerciseDef` + a Svelte component keyed by
the same `id` — no core changes (see `docs/DESIGN.md` §11.2).

Everything except `/api/health`, `/api/models` and the auth routes requires a
session. All data is scoped to the signed-in user.

## Dev

```bash
just dev         # API on :4318, serving the built PWA
just dev-web     # SvelteKit dev server on :5173 (proxies /api → :4318)
just build       # build the PWA into apps/web/build
just check       # typecheck server + web
```

## Layout

```
apps/server    Bun + Hono API, SSE, SQLite, multi-user auth, PWA host, speech supervisor
apps/web       SvelteKit PWA (mobile-first) — chat, voice, history, settings
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
- [x] Phase 2 — backend (Hono, SQLite, OpenRouter, speech supervisor) — 21 tests green
- [x] Phase 3 — multi-user auth + SvelteKit PWA (chat, voice, history, settings)
- [x] Phase 4 — exercise engine + cards (HSK 1 · JLPT N5 · 6 exercise types · XP)
- [x] Phase 5 — pronunciation scoring (ASR + forced aligner + optional judge)
- [x] Phase 6 — gamification (XP ledger, levels, UTC streaks, daily goal, event bus)
- [ ] Phase 7 — packaging + docs

## Configuration

Copy `.env.example` to `.env` (dev) or `~/.config/tutor/env` and set
`OPENROUTER_API_KEY` (server fallback), plus `TUTOR_SECRET` to encrypt per-user
keys at rest. Each user then picks their own models and key in the app. Set
`TUTOR_ALLOW_REGISTRATION=false` once everyone has an account.
