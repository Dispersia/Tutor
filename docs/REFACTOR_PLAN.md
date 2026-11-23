# Tutor — decomposition & architecture plan

> Status: **phases 0–13 landed.** A second pass (Phases 9–13) split the two mega
> routes, the grammar tables, the schema and the web skills client, lowered the
> function budget to 20 lines, and fixed the action-level map rebuild. Phases 14
> (the function burn-down) and 15 (web shells, route validation) are open — see
> §8.2. Goal: no mega files, no mega structs, no mega methods. Small files, small
> pure functions, like‑with‑like, modern practices. §8 records each phase; §8.1 is
> the re-audit that opened the second pass.

---

## 1. Where we are today

The repo grew fast. Organised by feature already (`game/`, `deck/`, `db/`,
`exercises/`…), but four patterns have become the drag:

| File | Lines | Problem |
| --- | ---: | --- |
| `apps/server/src/game/skills.ts` | 3208 | Domain **data** (skills, items, actions, enchants, gems) fused with **helpers**; one file, one giant module |
| `apps/server/src/game/service.ts` | 2416 | The whole game application layer: XP, actions, idle, gear, combat, SRS, curriculum, bands, talents |
| `apps/server/src/db/repo.ts` | 1427 | **105** exported queries across every table — one file, no domain boundary |
| `apps/web/src/app.css` | 903 | Global stylesheet: tokens, base, layout, components, animations |
| `apps/server/src/exercises/index.ts` | 769 | 9 exercise definitions + shared helpers in one file |
| `apps/server/src/deck/generate.ts` | 746 | Deck build + grow + import orchestration |
| `apps/server/src/routes/practice.ts` | 731 | One `registerPractice` closure holding ~12 handlers |
| `apps/server/src/routes/decks.ts` | 607 | One `registerDecks` closure, ~20 handlers |
| `apps/web/src/routes/(app)/skills/[id]/+page.svelte` | 875 | Page component with data, state, math and markup |
| `apps/web/src/routes/(app)/settings/+page.svelte` | 771 | Same |
| `apps/web/src/routes/(app)/practice/+page.svelte` | 742 | Same |
| `apps/web/src/routes/(app)/inventory/+page.svelte` | 681 | Same |
| `apps/web/src/routes/(app)/learn/+page.svelte` | 666 | Same |
| `apps/server/src/db/schema.ts` | 422 | 26 tables in one file (acceptable-ish, but splittable by domain) |
| `apps/server/src/game/grammar.ts` | 523 | Pattern grammar + data tables |

The good news: the codebase already has two files that are exactly the target
style — `game/idle.ts` (pure math, one concern, documented) and
`srs.ts`/`gear.ts`/`bands.ts`. The plan below applies *their* shape everywhere.

---

## 2. Principles

1. **One reason to change per file.** A file named after a noun (skills, gear)
   holds only that noun's logic; a file named after a verb (build, grade) holds
   only that use case.
2. **Pure core, thin edges.** Maths and rules are pure functions with no `Db`.
   Only a thin *application* layer touches the database; only a thin *route*
   layer touches HTTP.
3. **Small by construction, enforced by tooling.** `max-lines`, `max-lines-per-function`
   (**20** lines — if it needs more, it is doing more than one thing; see Phase 13),
   `max-params`, no-barrel-cycle rules in ESLint, plus `knip` for dead code and
   `dependency-cruiser` for layer rules (routes → services → data → domain, never
   backwards).
4. **Data is data.** Content tables (skills, items, actions, monsters) live in
   `*.data.ts` files so the logic files stay small and reviewable.
5. **Load once per request.** A per‑request context object carries the expensive
   maps (`srsStateMap`, `listCards`, `actionLevelMap`, bonuses) so no handler
   recomputes them (see §7).
6. **Atomic use cases.** Every multi‑write operation runs in one transaction via a
   small `Db.transaction` helper.
7. **Validate at the boundary.** Request bodies/params parsed with a schema
   (Zod/Valibot), never `as {…}` casts.

---

## 3. Target server layout

```
apps/server/src/
  domain/                 # pure, no Db, no HTTP — the rules of the world
    skills/
      types.ts            # SkillId, SkillDef, Mod, categories, Slot, ActionDef…
      skills.data.ts      # SKILLS
      actions/
        index.ts
        gathering.data.ts
        artisan.data.ts
        support.data.ts
        combat.data.ts
        actions.ts        # weaponSkill, actionRequiredLevel, actionsForSkill, rolls…
      items.data.ts       # ITEMS
      gear.types.ts       # GearStats, quality, slots
      gems.ts             # GEM_TYPES/TIERS + gemRingStats
      essences.ts         # ESSENCES + essenceFamily/essenceId
      enchants.data.ts    # ENCHANTS
      enchants.ts         # enchantsForSlot, familyForStat
      value.ts            # itemValue, DISTILL_XP_PER_VALUE
    idle.ts               # (move as-is — the model file)
    srs.ts
    gear.ts               # deriveStats, rollGearStats, set bonuses…
    bands.ts
    talents.ts
    combat.ts             # monster maths, rollDrops
    modifiers.ts
    levels.ts
    grammar/              # split noun tables from the builder
      nouns.data.ts
      build.ts
    curriculum.ts
  data/                   # the only layer that knows SQL/drizzle
    repo/
      index.ts            # barrel re-exporting the public queries
      users.ts
      auth.ts
      decks.ts
      cards.ts
      reviews.ts
      xp.ts               # xp ledger, stats
      srs.ts
      lessons.ts
      game.ts             # action progress, rigs, gather log, inventory
      gear.ts             # instances, equipment, sets
      talents.ts
      encounters.ts
      settings.ts
      push.ts
      audio.ts
    schema/               # schema.ts split by domain, re-exported from schema/index.ts
      users.ts cards.ts game.ts gear.ts srs.ts push.ts index.ts
    client.ts
    migrate.ts
  services/               # application layer — orchestrates domain + data
    progress/             # xp, action levels, bonuses, summary, streak, activity
      leveling.ts
      bonuses.ts
      summary.ts
    idle/                 # settleAll, completeAction, stopRig, settleReport
      settle.ts
      drill.ts
    gear/                 # craft/equip/salvage/distill/enchant/gear sets
      craft.ts
      equip.ts
      dismantle.ts
      sets.ts
    combat/               # startEncounter, combatResolve, playerCombat
      encounter.ts
      resolve.ts
      player.ts
    srs/                  # recordReview, studyBudget, srsStats, desiredRetention
      review.ts
      budget.ts
      stats.ts
    talents/              # chooseTalent, talentView
      choose.ts
      view.ts
    curriculum/
      view.ts
    context.ts            # per-request LoadedContext (§7)
  routes/
    practice/
      index.ts            # registerPractice → mounts the files below
      next.ts grade.ts speak.ts quiet.ts studyMore.ts
      select.ts           # pickStudyCard/pickReviewCard/resolveLesson (pure-ish)
      judge.ts            # LLM judge factory
    decks/
      index.ts build.ts grow.ts import.ts cards.ts pitch.ts settings.ts
    skills/ combat/ settings/ chat/ audio/ push/ speech/ stats/ auth/ models/ …
  exercises/
    index.ts              # registry assembly only
    introduce.ts translate.ts multipleChoice.ts typeListen.ts speakWord.ts
    converse.ts sentenceBuild.ts grammarCloze.ts
    shared/               # shuffle, seededRandom, normalizeSentence, exampleFor
  deck/                   # rename to features/deck or keep; split
    generate/ build.ts grow.ts import.ts persist.ts
    plan.ts pitch.ts mandarin.ts kanjium.ts settings.ts reinforce.ts planner.ts
  llm/  pronunciation/  push/  seed/  anki/  frequency/  speech/  audio/
```

**Layer rule:** `routes → services → data → domain`; `domain` imports nothing
from the app. Enforced with `dependency-cruiser`.

---

## 4. Target web layout

SvelteKit routing stays. Each route page becomes a **thin shell** that assembles
small components and a rune store; all logic moves to `lib/`.

```
apps/web/src/
  styles/
    tokens.css        # :root, theme vars, fonts
    base.css          # resets, typography, safe-areas
    components.css    # shared primitives
    animations.css    # rise, hit-shake, recording (with reduced-motion)
  lib/
    api/              # api.ts, cache.ts, ApiError
    state/            # session.svelte.ts, activeDeck.svelte.ts, per-page stores
    features/
      skills/         # skills.ts (client fns) + components/ + state
      practice/       # exercises.ts + components/exercises/*
      combat/ inventory/ bank/ gear/ learn/ chat/ settings/
    components/         # truly shared: Icon, Spinner, CharCell, Pitch, CardEditor…
```

Every `+page.svelte` over ~250 lines gets split into
`routes/(app)/<feature>/+page.svelte` (wiring) +
`lib/features/<feature>/components/*.svelte` + `lib/features/<feature>/state.svelte.ts`.

---

## 5. Cross-cutting modern practices

- **Validation:** add `zod` (or `valibot`); `parseBody(c, Schema)` helper in
  `routes/shared.ts`. Replaces every `(await c.req.json()) as X`.
- **Unit of work:** `withTx(db, fn)` helper in `data/`; wrap `settleAll`,
  `combatResolve`, `recordReview`, deck import, etc.
- **Typed errors:** an `AppError`/`Result` type so handlers stop returning ad-hoc
  `c.json({ error }, 40x)` shapes and share one error mapper.
- **Career/context load:** `loadContext(db, userId)` (see §7) built once per
  request, passed to services.
- **Path aliases:** `#domain`, `#data`, `#services` in tsconfig + vite, matching
  the existing `#lib` alias style on web.
- **Content vs logic:** every data table in a `*.data.ts`; logic imports it.
- **Tests:** colocate per module (already the norm); add a smoke test per split
  file to lock behaviour before moving code.
- **Docs:** each new module file gets the existing header-comment convention
  (a doc link + a one-line contract).

---

## 6. Split mechanics (safe extraction)

Pure moves, no behaviour change, one commit per module:

1. Cut a section into the new file, keep exports identical.
2. Re-export from the old path temporarily (`export * from './newfile'`) so
   call-sites don't move yet.
3. Run `bun test` + `just check` (typecheck) — green.
4. Repoint imports in a second commit, drop the temporary re-export.

This keeps every commit reviewable and revertable.

---

## 7. Efficiency & correctness findings (verified while planning)

These are real, not stylistic — worth fixing **during** the split.

<callout>

**Efficiency**

1. **Repeated full scans per request.** `routes/practice.ts` `/next` calls
   `srsStateMap` ~3× and `listCards` ~5×; `studyBudget` internally calls both
   again; `readingMap` scans all cards; `knownWords` re-scans and re-maps.
   `srsStats` calls `listCards` + `srsStateMap` *and* `studyBudget` (which
   repeats both). → One `loadContext(db, userId)` per request.
2. **`actionLevelMap` rebuilt constantly.** `skillLevelOf` rebuilds it on every
   call, and `awardActionXp` calls `skillLevelOf` **3×** plus `aggregateBonuses`.
   `combatResolve` calls `awardActionXp` up to **3×** plus its own
   `aggregateBonuses` → ~7 full action-level rebuilds per combat hit.
3. **`completeAction` calls `aggregateBonuses` twice** (once via `settleAll`,
   once at the end).
4. **`countUsers` loads every user row to count** (`select().all().length`) —
   should be `SELECT count(*)`.
5. **The whole XP ledger is loaded** by `dailyXp`, `activeDays`, `activitySeries`,
   `sumXp`, `rebuildStats` — should be a SQL aggregate with a day/group index.
6. **`settleAll` is documented as "one transaction" but is not transactional.**
   It issues per-rig `setRigState`, per-item `addItems`, per-item
   `recordGearCrafts` and per-action `awardActionXp` as separate writes.
7. **`getCard` filters `userId` in JS** after `select().where(id = ?)`; push the
   user filter into SQL.

**Correctness / robustness**

8. **No request-body validation anywhere** — handlers cast `await c.req.json()`
   with `as {…}`, so malformed input reaches domain code (e.g. `choiceId`,
   `latencyMs`, `deckId`).
9. **Duplicated idle maths across server and web.** `web/lib/idle.ts`
   (`rigGainedSince`) and the server's `idle.ts` implement the same accrual
   curve independently, and `fmtInterval` mirrors `rigRateLabel` — these can
   drift. Share the pure functions via `packages/core`.
10. **`grammar.ts` / `skills.ts` mix large data tables with logic**, so a data
    edit and a rule edit touch the same file (merges and review noise).

**Review, not necessarily bugs**

- `settleRig` clamps a starved artisan's carried fractional craft to `0.999`,
  so the carry after any starvation is always ≈1 craft regardless of how much
  was really pending. Looks deliberate (bound offline progress) but undocumented
  and untested; add a test to pin the intent.
- `combatResolve` grants `defenceXp`/`constitutionXp` a minimum of `1` even when
  no damage lands; confirm that is wanted.

</callout>

---

## 8. Phased plan

Each phase is independently shippable and typechecked.

**Phase 0 — guardrails (done).**
ESLint flat config (`eslint.config.js`) with `max-lines` (400),
`max-lines-per-function` (80) and `max-params` (5) as errors, plus
`@eslint/js` + `typescript-eslint` + `eslint-plugin-svelte` recommended.
Defaults over the legacy mega files live in one `legacyBig` list — remove an
entry when its file fits. `dependency-cruiser` (`.dependency-cruiser.cjs`)
enforces no import cycles and the future layer direction; `knip` reports dead
code (advisory for now). Scripts: `bun run lint`, `bun run arch`, `bun run knip`,
wired into `just lint`.
Two cycles the new rule caught were fixed here: `core/index ↔ templates` (types
moved to `packages/core/src/types.ts`) and `context ↔ pronunciation/assess`
(`AssessFn` moved to `pronunciation/types.ts`). Path aliases (`#domain` …) are
deferred to the phase that creates those folders — an alias to a missing path is
noise.

**Phase 1 — domain data out of `skills.ts` (done).**
`game/skills.ts` (3208 lines) became `game/skills/`: `types.ts`, `slots.ts`,
`xp.ts`, `skills.data.ts`, `items.data.ts`, `gems.ts`, `essences.ts`, `value.ts`,
`enchants.ts`, `actions.data.ts`, `lookups.ts`, `actions.ts` and a thin `index.ts`
barrel. Call sites keep importing `game/skills` (the barrel), so nothing else
changed. `*.data.ts` are content tables and are exempt from the size budget;
`legacyBig` no longer lists `skills.ts`. Verified: typecheck, svelte-check, 369
tests, `bun run arch` (cycles + layers) all green.

**Phase 2 — split `db/repo.ts` by table/domain (done).**
`db/repo.ts` (1427 lines, 105 exports) became `db/repo/*`: `settings`, `users`,
`auth`, `sessions`, `decks`, `cards`, `reviews`, `xp`, `game`, `talents`, `gear`,
`encounters`, `srs`, `lessons`, `push`, a `helpers` module for the shared
`now`/`id`, and an `index.ts` barrel. Call sites keep importing `db/repo`.
`legacyBig` no longer lists `repo.ts`. Still to do here: split `schema.ts` by
domain behind `schema/index.ts` (deferred — it is 26 tables of pure declarations
and nothing imports it but its own repo modules).

**Phase 3 — split `game/service.ts` into `services/*` (done).**
`game/service.ts` (2405 lines) became `src/services/*`: `overview`, `progress`,
`talents`, `bands`, `gearInstances`, `items`, `idle`, `board`, `gear`,
`gearSets`, `combat`, `srs`, `curriculum`, `index.ts`. Call sites now import
`services`. Clearer names throughout: `settleAll → settleRigs`,
`getPlayerCombat → loadPlayerCombat`, `materializeWornGear → ensureWornGear`,
`bandBonusesFor → accountBandBonuses`, `activeSetBonusesFor → loadoutSetBonuses`,
`grantExactItems → grantFixedItems`, `recordActivity → touchActivity`,
`salvageGearInstance → salvageGear`, and other `*Of`/internal tweaks.
`combatResolve` (136 lines) was then split into `combatResolve.ts` with small
helpers (`encounterContext`, `autoEat`, `playerStrike`, `monsterStrike`,
`awardExchange`, `settleExchange`), and `startEncounter`/`recordReview` were
trimmed the same way. `services/context.ts` adds `loadLearnerData`, now used by
the practice `/next` hot path and `srsStats` so those scans happen once (finding
1). Still open: the same context for the remaining callers and the
`actionLevelMap`/`aggregateBonuses` repetition (findings 2–3, 7).

**Phase 4 — split the mega routes (1–2 PRs).**
`practice` and `decks` become folders of small handlers; add `parseBody`
schemas (finding 8) and the `AppError` mapper.

**Phase 5 — exercises & deck (1 PR).**
One file per exercise + `shared/`; `deck/generate.ts` into `build/grow/import/persist`.

**Phase 6 — web pages & CSS (done, except finding 9).**
`app.css` (903 lines) is now `styles/{fonts,tokens,base,components,animations}.css`
behind a thin `app.css`. Every large page was split: pure derivations into
`lib/<feature>view.ts` and presentational pieces into `lib/components/<feature>/`.
Line counts: profession 875→518, settings 771→568, practice 742→628,
inventory 680→466, learn 663→490, combat 516→347. Finding 9 is fixed too: the
idle curve and its rate label now live in `packages/core/src/idle.ts`, and the
server engine and web client both import them (`apps/web` gained a `@tutor/core`
dependency), so the two can no longer drift.

**Phase 7 — data-layer performance (done).**
`countUsers` is a `COUNT(*)`, the XP ledger is grouped in SQL (`xpByDay` /
`xpForDay`, so the streak and heat-map never load every event), `settleRigs` runs
in one transaction via a new `inTransaction` helper, `getCard` filters the user
in SQL, and migration `0020_indexes.sql` adds the missing `user_id` indexes
(reviews, xp_events, srs, inventory, action_progress, talents, equipment,
lesson_progress, attempts) — mirrored in `schema.ts`.

**Phase 8 — cleanup (done).**
Fixed a script that still imported the deleted `game/service`; removed the unused
`apps/web/src/lib/index.ts` barrel and its bare `#lib` mapping; dropped the unused
`@tutor/speech` (server) and `@tutor/core` (speech) dependencies; `knip`'s
CLI-only deps are ignored in config. `docs/DESIGN.md` §11.2 now points at the
`exercises/defs` + `exercises/index` layout and at this plan's §3 for the module
map; the stale `game/service.ts` reference is fixed. The remaining `knip` report
is an advisory baseline of unused exports to clear as modules are touched — the
barrels (`db/repo`, `services`, `game/skills`, `deck/generate`, `exercises`) are
the public entry points, so they stay.

---

## 8.1 Re-audit after Phase 8 (what is still oversized)

A fresh pass over what `legacyBig` / `legacyFunctions` still hide, plus new
findings. Line counts are the files as they stand at `d43a606`.

| File | Lines | Problem |
| --- | ---: | --- |
| `apps/server/src/routes/practice.ts` | 742 | Phase 4 never ran: one `registerPractice` closure, 8 handlers + pure selectors + LLM-judge factory in one file |
| `apps/server/src/routes/decks.ts` | 602 | Phase 4 never ran: one `registerDecks` closure, 10 handlers + a `DECK_SCHEMA` blob + the pitch annotator factory |
| `apps/server/src/game/grammar.ts` | 522 | Phase 5 never ran: 14 `PATTERNS` + the semantic/gender tables fused with `buildSentence`/`matchesSlot`/`candidatesFor` |
| `apps/server/src/db/schema.ts` | 459 | 26 tables of pure declarations in one file (Phase 2 deferred it) |
| `apps/server/src/routes/skills.ts` | 405 | 16 handlers over one resource; `boardSkills` builds a whole profession tree in the route |
| `apps/web/src/lib/skills.ts` | 506 | 35 DTO interfaces + 25 client functions in one module; a page importing one type pulls the whole API surface |
| `apps/web/src/routes/(app)/{practice,settings,skills/[id],learn,inventory,home}` | 404–628 | Still above the ~250-line shell target after Phase 6 |
| `apps/web/src/styles/components.css` | 527 | One stylesheet for every shared primitive and feature |

New findings this pass:

**Correctness / efficiency**

1. **`awardActionXp` rebuilds the action-level map up to 3× per award** when no
   `ProgressCtx` is passed: `aggregateBonuses` loads it once, then each of the
   three `skillLevelOf` calls (`skillBefore`, the milestone check, the return
   value) reloads it. Every caller that awards several actions in a row (`combat`
   passes a ctx) is fine; a single award pays for 4 `listActionProgress` scans.
2. **`awardActionXp` re-reads `getActionXp` and re-writes `setActionXp` per
   award**, but a `ProgressCtx` already knows the level — the XP row still has to
   be read, so this one is acceptable, not a bug.
3. **`combatResolve` runs `loadProgress` and then `encounterContext` →
   `loadPlayerCombat(…, levels)`; `combat.ts` `monsterState` re-derives bands per
   monster**, so `/api/combat` settles rigs, loads progress twice
   (`boardSkills`-style) and derives gear stats per monster. Reading the combat
   screen loads the action map at least twice.
4. **`routes/skills.ts` and `routes/combat.ts` each build the "board"/player view
   from scratch per request**, with no shared per-request context; two GETs in
   the same page render recompute `settleRigs` (a write path) twice.
5. **`learnerOf` is duplicated verbatim in `routes/practice.ts` and
   `routes/combat.ts`**, and the same `{card, learner, distractors, readings,
   known, showReadings}` exercise-context literal is assembled in four places
   (practice next, practice grade, practice speak, combat hit/start).

**Structure**

6. `registerPractice` / `registerDecks` / `registerSkills` are the last
   "register everything in one closure" route modules; the per-handler split is
   what makes a route's schema, guards and body cast reviewable in isolation.
7. `apps/web/src/lib/skills.ts` is a barrel that mixes wire DTOs with `fetch`
   wrappers; the DTOs belong in `lib/skills/types.ts` so components import only
   types.
8. `db/schema.ts` monolith makes a data edit and a query edit touch one file.

---

## 8.2 Phase list (second pass)

Each phase is independently shippable and typechecked, one module per commit.

**Phase 9 — split the mega routes (done).**
`routes/practice.ts` (742) became `routes/practice/`: `index.ts` (registration
only), `select.ts` (the pure selectors — `pickStudyCard`, `pickReviewCard`,
`resolveLesson`, `readingMap`, `pickNextExercise`, `lessonOfCard`), `exerciseCtx.ts`
(the one assembled exercise context, plus the shared `learnerOf`), `judge.ts` (the
LLM-judge factory), `action.ts` (`settleAction`), `catalog.ts` (the GET catalog),
`next.ts`, `grade.ts`, `speak.ts`, `studyMore.ts`. `routes/decks.ts` (602) became
`routes/decks/`: `index.ts`, `view.ts` (`deckView` + the pitch fetcher factory),
`cards.ts`, `create.ts`, `import.ts`, `grow.ts`, `settings.ts`, `pitch.ts`.
`learnerOf` and the exercise-context literal now live in
`routes/practice/exerciseCtx.ts`, and `routes/combat.ts` imports them, so the
duplication (finding 5) is gone. `legacyBig` no longer lists either route. Every
function in the split modules was then held to the new 20-line budget, so
neither module is in `eslint.function-baseline.js` either.

**Phase 10 — split `game/grammar.ts` (done).**
The pure pattern data (`PATTERNS`, the semantic sets, the English gloss tables)
moved to `game/grammar/patterns.data.ts`; `nounClass`/`SENTENCE_POS`/`buildSentence`
/`canBuildSentence` and the slot matcher live in `game/grammar/build.ts` behind a
thin `game/grammar/index.ts` barrel. Call sites keep importing `game/grammar`.
`legacyBig` no longer lists `grammar.ts`.

**Phase 11 — split `db/schema.ts` (done).**
`db/schema.ts` (459) became `db/schema/`: `users.ts`, `content.ts` (decks/cards/
sessions/messages), `history.ts` (reviews/attempts/xp/stats/settings), `game.ts`
(action progress/gather log/inventory/talents), `gear.ts` (instances/equipment/
sets/player state), `srs.ts`, `push.ts`, `audio.ts`, behind `db/schema/index.ts`.
Every importer keeps using `db/schema` (or `../db/schema`). `legacyBig` no longer
lists `schema.ts`.

**Phase 12 — web: split `lib/skills.ts` (done).**
`apps/web/src/lib/skills.ts` became `apps/web/src/lib/skills/`: `types.ts` (every
DTO) and `client.ts` (the `api()` wrappers) behind `skills/index.ts`, so a
component can import a type without pulling the fetch surface. `legacyBig` no
longer lists `web/…/lib/skills.ts`.

**Phase 13 — efficiency & the function budget (done).**
(a) `awardActionXp` no longer rebuilds the action-level map: it derives the map
once (from `ctx` or `listActionProgress`), threads that map into every
`skillLevelOf` call and into `aggregateBonuses`, and computes the profession
level once, so a single award is one scan instead of three (finding 1).
(b) `max-lines-per-function` dropped from 80 to **20**: a function over twenty
lines is doing more than one thing. Every module this pass wrote or rewrote
(the two route splits, the grammar engine, the web skills client, the combat
route) was split to fit, and its `legacyFunctions` entry removed. The files that
were already over twenty lines before the bar moved are listed in
`eslint.function-baseline.js` — a burn-down list that only ever shrinks (127
files holding 255 long functions when the bar moved).

**Phase 14 — the function burn-down (in progress).**
Work the `eslint.function-baseline.js` list to zero, worst first. The five mega
route modules (`skills`, `settings`, `chat`, `auth`, `push`) are folders of small
handlers. The FSRS scheduler (`game/srs.ts:schedule`, 162 lines) split into
`newCard`/`sameDay`/`lapse`/`reviewPass`/`graduate`/`stayStep`; the combat
resolver and the player's combat maths split the same way; the audio service's
112-line `createAudioService` became a store plus free functions; the exercise
grader `speakWord` and the deck builder (`createDeckForBuild`/`fillDeck`) split
into planning and persistence steps; `services/{srs,board,talents,idle}`,
`game/idle.ts:settleRig`, `db/repo/encounters.ts` and the web `lib/api.ts`
followed. Tests got their own, larger ceiling (**60** lines: a case is
arrange/act/assert, read as one unit) instead of the production 20, and the
long ones were split or given `getJson`/`postJson` helpers. The settle pass and
drill (`services/idle.ts`), the n+1 reinforcement, the OpenRouter client, the web
chat streamer and the sentence-builder exercise followed, then the pronunciation
feature maths, the web speech client, the deck growth planner and the gear
service, then the converse grader, `game/study.ts`, gear sets, the push client
and the deck-delete query. That took the list from 127 files / 255 functions to
**54 files / 85 functions**. The biggest left are exercise graders and repository
row mappers, all under 60 lines. The list shrinks; it never grows, and new code is
held to 20 from day one.

**Phase 15 — the web shells & route validation (open).**
The remaining `+page.svelte` files over ~250 lines (`practice`, `settings`,
`skills/[id]`, `learn`, `inventory`, `home`) get the Phase 6 treatment: pure
derivations into `lib/<feature>view.ts`, presentational pieces into
`lib/components/<feature>/`. `styles/components.css` splits per feature. Then
Phase 4's other half: a `parseBody(c, schema)` helper (valibot) replaces the
remaining `(await c.req.json()) as {…}` casts in the split routes, and the
`Deps`/per-request context (findings 3–4) gains one shared board/player loader.

---

## 9. Risks & non-goals

- **Risk: churn while features land.** Mitigate with the re-export shim and one
  module per commit so `master` always typechecks.
- **Risk: behaviour drift during moves.** Mitigate: tests move with the code,
  green after every commit.
- **Not doing:** new features, framework changes, or a monorepo restructure. This
  is a decomposition of what exists — nothing more.
