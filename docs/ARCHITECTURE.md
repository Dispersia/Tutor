# Architecture — where code lives and the rules it follows

What the system does and why is in [`DESIGN.md`](DESIGN.md). This page is the
map: the layout, the layer rules and the budgets the tooling enforces. Open
defects and planned refactors are in [`BACKLOG.md`](BACKLOG.md).

## Workspace

```
apps/server     Bun + Hono API, SQLite (drizzle), speech supervisor, PWA host
apps/web        SvelteKit PWA (Svelte 5 runes, static adapter)
packages/core   types and pure functions shared by server and web (idle curve, templates)
python/speech   the MLX speech gateway (FastAPI): ASR, forced aligner, TTS
scripts/        maintenance CLIs that open the live database
nix/, deploy/   packaging, the launchd agent and the nix-darwin module
design/tutor/   a static HTML prototype of the visual system (not built or shipped)
```

## Server (`apps/server/src`)

```
routes/     HTTP only: parse the body (routes/body.ts), call a service, shape the reply
services/   use cases: orchestrate game rules + repo queries; multi-write ones are atomic
db/         schema/ (drizzle tables by domain), repo/ (every SQL query), migrate, client
game/       the rules of the world — pure: no database, no HTTP
exercises/  one file per drill under defs/, plus the registry
deck/       deck building: the LLM planner, growth, the lexicon, Anki import glue, readings, pitch
text/       shared text utilities: normalisers, reading keys, Zhuyin, furigana, the lexicon
ime/        reverse-index lookups for the in-app IME (Zhuyin → hanzi, kana → kanji)
llm/ audio/ speech/ pronunciation/ push/ anki/ frequency/   integrations
seed/       the curated starter decks — a test fixture, not runtime code
```

**Layer direction:** `routes → services → db → game`, never backwards.
`bun run arch` (dependency-cruiser) fails on a cycle, on `game/` importing
`db|services|routes`, on `db/` importing `services|routes`, and on `services/`
importing `routes`.

Conventions:

- **Content is data.** Tables of skills, items, actions and grammar patterns live
  in `*.data.ts`; the logic that reads them stays small.
- **Barrels are the entry points**: `db/repo`, `db/schema`, `services`,
  `game/skills`, `game/grammar`, `deck/generate`, `exercises`.
- **Multi-write use cases are all-or-nothing.** Wrap the function with `atomic()`
  (`db/repo/helpers.ts`); it nests as a savepoint. Services are synchronous, so
  an `await` can never sit inside a transaction.
- **Events fire after the commit.** `bus.emit` inside a transaction is held
  until the outermost one commits, and dropped if it rolls back (`events.ts`), so
  a subscriber never sees a write that did not happen.
- **One error shape.** Routes answer errors with `fail(c, status, message)` from
  `routes/errors.ts` (`{ error }`), and a missing OpenRouter key with `needKey`.
- **One helper per text job.** Normalising, reading keys and language names live
  in `text/` and `llm/prompts.ts` (`langName`); calls to the speech gateway go
  through `withGateway` (`speech/gateway.ts`). Do not write a local copy.
- **Equipment is its instances.** `gear_instances` is the only record of owned
  gear; `getItemCount`/`listInventory`/`addItems` handle that in one place
  (`db/repo/game.ts`). Use `spendableCount` when something is to be *spent*:
  worn gear is owned but never consumed.
- **Ids are branded** (`ids.ts`): `UserId`, `DeckId`, `CardId`, `SessionId`,
  `GearInstanceId`, `GearSetId`. Passing one where another is expected is a
  compile error. They are branded at the schema (`.$type<…>()`), so rows come out
  typed; turn a raw string into one only where it enters (`idField` for a request
  body, `toDeckId(c.req.param('id'))` for a route param). Game-content ids
  (skills, items, actions) stay as they are.
- **Validate at the boundary.** Read request bodies with `jsonBody` and the typed
  readers in `routes/body.ts`; never cast `await c.req.json()`.
- **Everything is scoped by `userId`.** Decks, cards and progress belong to one
  member: pass the member to `listDecks`/`listCards`/`getDeck` and they see only
  their own rows. Server-wide controls (the shared recording queue, the speech
  gateway, the member list) go through `adminOnly` (`routes/guards.ts`).
- **Days come from `services/clock.ts`**, never `toISOString().slice(0, 10)`: a
  day starts at the member's own midnight.
- **Load once per request.** `services/context.ts` (`loadPlayerCtx`,
  `loadLearnerData`) carries the expensive maps; pass it down instead of
  re-querying.
- **No comments in code.** Names and small functions carry the meaning; the
  why lives in `docs/DESIGN.md`. See `AGENTS.md`.

## Web (`apps/web/src`)

```
routes/(app)/<feature>/+page.svelte   thin shells: state + wiring
lib/components/<feature>/             presentational pieces
lib/<feature>view.ts                  pure derivations for a page
lib/skills/                           the skills/gear client (types.ts + client.ts)
lib/ime/                              in-app input methods: hangul/kana/bopomofo engines
lib/api.ts, cache.ts, session.svelte.ts, paths.ts   fetch, GET cache, session, base path
lib/resource.svelte.ts                 cachedResource(path): seed from cache, then refresh()
                                       (never throws) or load() (rejects, for flows that must abort)
lib/skills/store.svelte.ts             the one shared skills board (useSkills())
lib/clock.svelte.ts                    the one shared ticker
lib/haptics.svelte.ts                  key-press vibration intensity (per user)
styles/                               tokens, base, components/<family>.css, animations
```

- **Every link, `goto` and fetch goes through `lib/paths.ts`** (`href()`): the app
  is served under `/tutor` in production and the base path is baked into the build.
- Shared maths comes from `@tutor/core`, so the server engine and the client
  extrapolation cannot drift.
- The visual system is the root [`DESIGN.md`](../DESIGN.md); product intent is
  [`apps/web/PRODUCT.md`](../apps/web/PRODUCT.md).

## Budgets and gates

| Gate | Command | Enforces |
| --- | --- | --- |
| Format | `bun run format:check` | Prettier |
| Lint | `bun run lint` | 400 lines per file, 20 per function (60 in tests), 5 params; `*.data.ts` exempt |
| Architecture | `bun run arch` | no cycles, layer direction |
| Types | `bun run typecheck`, `bun run --cwd apps/web check` | server, packages, `scripts/`, web |
| Tests | `bun test` | colocated `*.test.ts` |

`bun run verify` (or `just ci`) runs all of them. `bun run knip` reports unused
exports (advisory). Nothing lints or tests `python/` yet.

## Database

- Migrations are plain SQL in `apps/server/migrations/`, applied in filename order
  at startup and embedded into the compiled binary (`just gen` regenerates
  `db/migrations.gen.ts` — run it after adding or editing one).
- SQLite runs in WAL mode with `foreign_keys = ON`, `busy_timeout = 5000` and
  `synchronous = NORMAL`; the maintenance scripts open the same file while the
  server runs.

## Deploying

See [`AGENTS.md`](../AGENTS.md) and [`deploy/README.md`](../deploy/README.md):
the live server is a launchd agent on the Mac running the Nix-built binary, so a
change is not live until it is rebuilt and restarted.
