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

**Run it (packaged):**

```bash
nix run .#fetch-models   # one-time: cache the MLX weights (~11 GB) in ~/.local/share/tutor/models
nix run .                # build + run; first run creates the speech venv (uv sync)
```

Open http://127.0.0.1:4318 — the PWA (sign up → chat, talk, practise). The
packaged `nix build` produces a single ~85 MB Bun binary plus the built PWA; the
Python/MLX venv and the weights live under `$TUTOR_DATA_DIR` (default
`~/.local/share/tutor`), never in the Nix store.

**Develop:**

```bash
nix develop          # bun + python3.12 + uv + ffmpeg + just
just setup           # install JS + Python deps
just models          # download the MLX checkpoints into ./models
just dev             # API on http://127.0.0.1:4318 (serves the built PWA)
just dev-web         # SvelteKit dev server on :5173
just bench           # measure ASR/TTS latency + peak RAM
just check           # typecheck server + web
```

Set `OPENROUTER_API_KEY` (server fallback) in `.env` or `~/.config/tutor/env` —
or let each user paste their own key in Settings. Set `TUTOR_SECRET` to encrypt
those keys at rest.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/register` · `/login` · `/logout` · `GET/PUT /api/auth/me` | accounts (first user is admin) |
| `GET /api/users` · `DELETE /api/users/:id` | admin: manage accounts |
| `GET /api/health` | server + speech status |
| `GET /api/models?q=` | live OpenRouter catalogue for the model picker |
| `GET/PUT /api/settings` | per-user roles, voice + daily goal |
| `PUT /api/settings/openrouter-key` | each user's own key (server key is a fallback) |
| `POST /api/chat` · `/api/chat/json` | streamed chat (SSE) + structured output |
| `GET/POST /api/sessions`, `GET /api/sessions/:id` | per-user history |
| `GET/POST /api/decks`, `GET /api/decks/:id/cards` | starter decks (HSK 1, JLPT N5) + AI-generated decks |
| `GET /api/exercises` | the exercise registry |
| `POST /api/practice/next` · `/api/practice/grade` · `/api/practice/speak` | next drill · grade it (+XP) · pronunciation |
| `GET /api/skills` | the profession board (skills, actions, talents, bank, gear) |
| `POST /api/skills/talents` · `/api/skills/equip` | choose a talent · equip/unequip gear |
| `GET /api/combat` · `POST /api/combat/{start,hit}` | monsters, player HP · start a fight · land a hit |
| `GET /api/stats` | XP, level, streak |
| `GET /api/speech/health` · `POST /api/speech/{tts,asr,align,assess,wake,unload}` | speech, lazily started/stopped |

Adding an exercise type takes a backend `ExerciseDef` + a Svelte component keyed by
the same `id` — no core changes (see `docs/DESIGN.md` §11.2). Adding a profession
is content only (`apps/server/src/game/skills.ts`) — see §13.5.

Everything except `/api/health`, `/api/models` and the auth routes requires a
session. All data is scoped to the signed-in user.

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
- [x] Phase 7 — packaging (`nix build` / `nix run .`) + docs
- [x] Phase 8 — professions, per-level effects, talents (5/10), materials & combat (monsters, HP, drops)

## Configuration

Copy `.env.example` to `.env` (dev) or `~/.config/tutor/env` and set
`OPENROUTER_API_KEY` (server fallback), plus `TUTOR_SECRET` to encrypt per-user
keys at rest. Each user then picks their own models and key in the app. Set
`TUTOR_ALLOW_REGISTRATION=false` once everyone has an account.
