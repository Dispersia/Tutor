# tutor

AI-first language learning. A local-first, Duolingo-like tutor where the **brain
is OpenRouter** (you pick the model) and the **speech is local on Apple MLX**
(Whisper for ASR, VoxCPM2 for TTS) — no cloud speech, and the models free your
RAM when idle.

- **Target:** Apple Silicon Mac as the server (16 GB tested), Android **PWA** as
  the primary client.
- **First languages:** Mandarin and Japanese, both as frequency-ordered paths.

Docs: [`docs/DESIGN.md`](docs/DESIGN.md) (what it does and why),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (where code lives, the rules and
the gates), [`docs/BACKLOG.md`](docs/BACKLOG.md) (open defects and refactors).
Before a change is done: `bun run verify` (or `just ci`).

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
| `GET /api/models?q=` | live OpenRouter catalogue for the model picker (key-filtered when a key is set) |
| `GET/PUT /api/settings` | per-user roles, voice + daily goal |
| `PUT /api/settings/openrouter-key` | each user's own key (server key is a fallback) |
| `POST /api/chat` · `/api/chat/json` | streamed chat (SSE) + structured output |
| `GET/POST /api/sessions`, `GET /api/sessions/:id` | per-user history |
| `GET/POST /api/decks`, `GET /api/decks/:id/cards` | decks, built on demand from an instruction + a pulled frequency list |
| `POST /api/decks/:id/grow` · `PATCH /api/decks/:id` | grow a deck organically (optionally on a topic) · set its reading rules |
| `POST /api/decks/:id/pitch` | backfill pitch-accent metadata for the deck's existing cards |
| `POST /api/decks/import` | build a deck from an uploaded Anki `.apkg` (its words are the source) |
| `GET /api/exercises` | the exercise registry |
| `POST /api/practice/next` · `/api/practice/grade` · `/api/practice/speak` | next drill · grade it (+XP) · pronunciation |
| `POST /api/practice/quiet` | "can't speak or listen right now": hide listen/speak cards for 15 min |
| `GET /api/skills` | the profession board (skills, actions, talents, bank, gear) |
| `POST /api/skills/talents` · `/api/skills/equip` | choose a talent · equip/unequip gear |
| `GET /api/combat` · `POST /api/combat/{start,hit}` | monsters, player HP · start a fight · land a hit |
| `GET /api/stats` | XP, level, streak |
| `GET /api/speech/health` · `POST /api/speech/{tts,asr,align,assess,wake,unload}` | speech, lazily started/stopped |

Decks are **not pre-seeded**. Describe one in the Learn tab (e.g. "a traditional
Chinese frequency list, with grammar, using only traditional characters and
zhuyin") and the server pulls a real frequency list
([Hermit Dave's FrequencyWords](https://github.com/hermitdave/FrequencyWords)),
then writes cards with the card templates — strictly one new word at a time
(n+1), following the deck's own reading rules. Decks grow organically: ask for a
topic ("ordering at a restaurant") and it appends another n+1 batch.

You can also **import an Anki deck** (`.apkg`) — its words become the source
instead of a frequency list, and the templates write the cards from them. The
**whole deck** is imported: its ordered words are the starter and the generator
weaves sentence and grammar cards through them, filling the deck in the
background so the request returns at once. The importer reads the collection
straight from the zip (no dependency), shows the deck's fields with a preview,
and lets you **pick which field is the real word** (plus optional
reading/meaning fields) before it builds anything. No guessing.

Adding an exercise type takes a backend `ExerciseDef` + a Svelte component keyed by
the same `id` — no core changes (see `docs/DESIGN.md` §11.2). Adding a profession
is content only (`apps/server/src/game/skills/*.data.ts`) — see §13.5.

Everything except `/api/health`, `/api/models` and the auth routes requires a
session. All data is scoped to the signed-in user.

## Hosting (Mac + Tailscale HTTPS)

Declared for nix-darwin — import the module:

```nix
imports = [ inputs.tutor.darwinModules.default ];
services.tutor = {
  enable = true;
  tailscaleServe.enable = true;                                   # HTTPS on your tailnet
  environmentFile = "/Users/dispersias/.config/tutor/env";
  # caddy.enable = true; caddy.hostname = "aarons-mac-mini.tail7c1ddb.ts.net";
};
```

Or ad-hoc: `just service-install && just tailscale-serve`. Full details in
[`deploy/README.md`](deploy/README.md).

## Layout

```
apps/server    Bun + Hono API, SSE, SQLite, multi-user auth, PWA host, speech supervisor
apps/web       SvelteKit PWA (mobile-first) — learn, practice, chat, skills, combat, bank
packages/core  shared types, card + exercise registry contracts
python/speech  MLX speech gateway (Whisper-turbo / VoxCPM2 / Qwen3-ForcedAligner)
nix/           packaging + model-fetch wrappers
docs/          DESIGN.md, ARCHITECTURE.md, BACKLOG.md
```

## Browser VAD

Every mic take is decoded and scored by [Silero VAD](https://github.com/snakers4/silero-vad)
on the phone (`@ricky0123/vad-web` + onnxruntime-web), and only the speech windows
are uploaded — the tap, the breaths and the thinking pauses are spliced out and the
clip is re-encoded as 16 kHz mono WAV. A take with no speech never leaves the
device, so the ASR is not even woken.

The weights and the wasm runtime (~16 MB) are **not** bundled or committed:
`apps/web/scripts/sync-vad-assets.mjs` copies them from `node_modules` into
`apps/web/static/vad/` with content-hashed names and a manifest, on every
`dev`/`build` (or `just vad`). Browsers fetch them lazily on the first recording and
cache them forever. If they cannot be loaded, the raw take is uploaded unchanged.

## Configuration

Copy `.env.example` to `.env` (dev) or `~/.config/tutor/env` and set
`OPENROUTER_API_KEY` (server fallback), plus `TUTOR_SECRET` to encrypt per-user
keys at rest. Each user then picks their own models and key in the app. Set
`TUTOR_ALLOW_REGISTRATION=false` once everyone has an account.

## Pitch accent data

Japanese pitch accents are resolved from the bundled Kanjium dictionary
(`apps/server/src/deck/kanjium-accents.txt`), by Uros O. and the Kanjium project,
licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
<https://github.com/mifunetoshiro/kanjium>

## Mandarin reading data

Chinese (Traditional) workloads get their reading from the bundled Taiwan
dictionary `apps/server/src/deck/mandarin-readings.txt`, built by
`scripts/build-mandarin-readings.py` from:

- 中華民國教育部《重編國語辭典修訂本》, via the
  [g0v/moedict-data](https://github.com/g0v/moedict-data) mirror — readings used
  verbatim, licensed
  [CC BY-ND 3.0 TW](https://creativecommons.org/licenses/by-nd/3.0/tw/).
- [McBopomofo](https://github.com/openvanilla/McBopomofo) — preferred character
  readings and additional words, MIT licensed.

## Licence

The code is under the [PolyForm Noncommercial License 1.0.0](LICENSE.md): anyone
may use, change and share it for any noncommercial purpose; selling it or using
it commercially is not permitted. Bundled dictionary data and fonts keep their
own licences — see [NOTICE.md](NOTICE.md).
