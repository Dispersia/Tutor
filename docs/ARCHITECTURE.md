# Architecture — where code lives and the rules it follows

What the system does and why is in [`DESIGN.md`](DESIGN.md). This page is the
map: the layout, the layer rules and the budgets the tooling enforces. Open
defects and planned refactors are in [`BACKLOG.md`](BACKLOG.md).

## Workspace

```
apps/server     Bun + Hono API, SQLite (drizzle), speech supervisor, PWA host
apps/web        SvelteKit PWA (Svelte 5 runes, static adapter)
packages/core   types and pure functions shared by server and web (idle curve, templates)
packages/speech typed speech-gateway client — unused today (BACKLOG §3)
packages/ui     placeholder — empty today (BACKLOG §3)
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
deck/       deck building: the LLM planner, growth, Anki import glue, readings, pitch
llm/ audio/ speech/ pronunciation/ push/ anki/ frequency/ seed/   integrations
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
- **Validate at the boundary.** Read request bodies with `jsonBody` and the typed
  readers in `routes/body.ts`; never cast `await c.req.json()`.
- **Every query is scoped by `userId`.** Server-wide controls (the shared
  recording queue, the speech gateway, the member list) go through `adminOnly`
  (`routes/guards.ts`).
- **Load once per request.** `services/context.ts` (`loadPlayerCtx`,
  `loadLearnerData`) carries the expensive maps; pass it down instead of
  re-querying.
- Each module opens with a header comment: what it owns and the `DESIGN §` it
  implements.

## Web (`apps/web/src`)

```
routes/(app)/<feature>/+page.svelte   thin shells: state + wiring
lib/components/<feature>/             presentational pieces
lib/<feature>view.ts                  pure derivations for a page
lib/skills/                           the skills/gear client (types.ts + client.ts)
lib/api.ts, cache.ts, session.svelte.ts, paths.ts   fetch, GET cache, session, base path
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
