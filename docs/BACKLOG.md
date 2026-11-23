# Backlog — open defects and refactors

From the 2026-11-23 repo sweep. **Remove an item when it is fixed**; what was
already fixed is in git history, not here. Items marked *(reproduced)* were run
against the real code; the rest come from reading it and should be confirmed
before work starts. `srv/` is `apps/server/src/`, `web/` is `apps/web/src/`.

## 1. Decide first (behaviour or balance — a product call)

1. **Idle XP depends on how often you settle, up to 2×.** A settle awards
   `round(crafted × 0.5)`: one craft per settle earns 1 XP, 100 crafts in one
   settle earn 50. Carry the fraction on the rig. `srv/services/idle.ts`
2. **Thieving's "coins" passive and the Legendary coins talent do nothing.**
   `Bonuses.coins` is only read for display. `srv/game/modifiers.ts`,
   `srv/services/items.ts`
3. **Grades are not bound to the drill the server issued.** `/api/practice/grade`
   and `/api/combat/hit` accept any owned card with any exercise, so a script can
   farm the easiest drill. Matters only if anything becomes competitive.
4. **Day boundaries are UTC** (by design, DESIGN §13): for UTC-7 the streak day
   rolls at 5 pm local. Needs a per-user timezone.
5. **Combat feel** (open since the combat rework): are monster hits noticeable
   enough (damage vs armour, auto-eat threshold, first-hit feedback)? Is 20 s the
   right drill timer, and should Start gate each fight or each session?
6. Combat quirks: a monster killed this exchange still lands its blow; restarting
   an encounter drinks another potion and resets monster HP.

## 2. Bugs

### Server

- **Deleting a user orphans most of their data** *(reproduced)*: `decks`, `cards`,
  `sessions`, `messages`, `reviews`, `attempts`, `xp_events`, `stats`,
  `audio_blobs` have no foreign key to `users`. `srv/routes/auth/admin.ts`
- **The action gate runs before an `await`, the drill settles after it**: two
  concurrent `/grade` calls can both pass with stock for one.
  `srv/routes/practice/grade.ts`
- **Login**: no dummy hash for unknown users (timing reveals accounts), no rate
  limit, and two concurrent first registrations both become admin.
  `srv/routes/auth/account.ts`
- **Chat is an unrestricted LLM proxy** on the server key (any model, any system
  prompt) and ignores client disconnects. `srv/routes/chat/index.ts`
- **Push**: an endpoint is reassigned to whoever submits it; the endpoint check is
  only "https" (blind SSRF); no fetch timeout; 401/403 are retried forever.
  `srv/db/repo/push.ts`, `srv/push/webpush.ts`
- **`deleteDeck`** is seven separate statements, and its lesson-progress delete is
  `LIKE '${level ?? id}:%'` with a client-supplied `level`: two decks sharing a
  level share progress, and `%` wipes all of it. `srv/db/repo/decks.ts`
- **Lesson ids collide across decks sharing a `level`** and are positional, so
  inserting a card shifts every later lesson. `srv/services/curriculum.ts`
- **Topic decks are written card-by-card from unvalidated LLM output**: one bad
  card leaves a half-filled deck. `srv/routes/decks/create.ts`
- **A built batch counts all its words** even when the model returned fewer or
  different ones; hallucinated vocab is persisted. `srv/deck/build.ts`
- **Pinyin → Zhuyin stores garbage** *(reproduced)* for readings with punctuation,
  tone digits or jyutping: `"ni3 hao3"` → `"˙ㄋㄧ ˙?3 …"`. `srv/deck/context.ts`
- **Fuzzy meaning grading is wrong both ways** *(reproduced)*: "eat" for "to eat"
  fails; "to give" for "to live" and "old" for "cold" pass.
  `srv/exercises/grading.ts`
- **A resumed import forgets its rules** (variant, reading script and per-word
  hints live only in memory) — and a restart follows every deploy.
  `srv/deck/growth.ts`
- **Reinforcement re-fires an LLM call on every review** once `lapses >= 3`, and
  stores pinyin under the `zhuyin` key. `srv/deck/reinforce.ts`
- **Pitch backfill is one unbatched LLM call** inside the request; a large deck
  overflows and the dictionary's correct answers are lost with it.
  `srv/deck/pitch.ts`
- **Speech supervisor**: `stop()` does not await exit, so an immediate `ensure()`
  spawns a second gateway that cannot bind; a gateway orphaned by a server crash
  is never adopted or stopped. `srv/speech/supervisor.ts`
- **OpenRouter client**: a mid-stream `error` chunk is saved as a normal message;
  `temperature`/`maxTokens` are silently ignored; JSON calls have no default
  timeout. `srv/llm/openrouter.ts`
- **`scripts/fix-deck-quality.ts`** calls `buildDeps`, which clears the live
  server's `building` flags and may start the speech gateway inside the script.
- **`updateSettings`** applies roles before validating `study`, so a 400 leaves a
  partial write. `srv/routes/settings/index.ts`
- **Old audio for shared words**: a clip recorded before clips were keyed by
  language is dropped the first time either language asks for it (it cannot be
  attributed), then re-recorded on demand. Expected; listed so the re-recording
  is not a surprise.

### Web

- **Nothing releases the mic, audio or streams on unmount**: start recording in
  Chat, tap a nav tab, and the mic stays live. `Recorder` has no `dispose`.
  `web/routes/(app)/chat/+page.svelte`, `Converse.svelte`, `SpeakWord.svelte`
- **Chat `send()` races the initial load** and can write deltas into the wrong
  message (the reply is tracked by array index).
- **No stale-response guards**: the in-flight GET dedupe has no generation, so a
  refresh after a mutation can paint pre-mutation data. `web/lib/api.ts`
- **No global 401 handling**: an expired cookie shows cached data plus an error
  banner until a hard reload. `web/lib/api.ts`
- **The API cache persists every GET to localStorage forever** (no allowlist, TTL
  or eviction) and hits the ~5 MB quota. `web/lib/cache.ts`
- **Service worker**: the offline shell fallback can never hit;
  `notificationclick` focuses a window without navigating to the target; a push
  that arrives while a window is focused shows nothing. `web/service-worker.ts`
- **A practice error replaces the card**, and "Back" loads a different one.
  `web/routes/(app)/practice/+page.svelte`
- One `growTopic` is bound into every deck's field; the hash-highlight effect on
  `skills/[id]` re-scrolls after every mutation; rig counters restart from "now"
  over stale data after an offline fallback.
- Accessibility: the Converse mic button has no accessible name; record toggles
  expose no state; two `aria-modal` dialogs neither move nor trap focus.

### Speech gateway (`python/speech`)

- **The three fixes from the sweep were never run** (no Python/MLX on the review
  machine): temp-file cleanup, sync upload handlers, the TTS temp file. Exercise
  `/v1/asr`, `/v1/assess` and `/v1/tts` once on the Mac.
- **Clip grading has never run against the real gateway.** The server side is
  tested with a fake recogniser; the gateway's new `reference` field on
  `/v1/asr` is unrun. Watch `rejected` in `GET /api/audio/status` and the
  `[audio] take n/3 … said …` log lines after the next backfill: they are the
  per-language pass rate.
- **Grading gaps.** Clips recorded before grading existed were never checked.
  Live playback (chat replies, "hear it" on a card) is not graded. A word that
  fails all three takes gets no clip until the next restart; if a language
  fails often, the next step is to record the word three times in one take and
  cut out the middle one with the aligner (not built).
- **The per-language accent is unheard.** Voices now ask for an accent
  (`packages/core/src/voice.ts`), but no clip was synthesised to confirm the
  model honours it. Clips recorded before the change keep their old voice.
- **The TTS runaway cap is dead**: `tts_synthesize` accepts `max_tokens`, `voice`,
  `language`, `mode`, `temperature` and forwards only `text` and `instruct`.
  `models.py`
- **Lock scope**: `get()` holds the manager lock for a whole model load, so
  `/health` hangs during a cold start; unload and cache-clear can run beside an
  inference. `models.py`
- No request-size limits; an ffmpeg failure passes the raw upload on instead of
  answering 400.

### Packaging and deploy (read only — nothing here was run on a Mac)

- **The base path is baked into the Nix wrapper**, so the darwin module's
  `basePath` option does nothing, and `just tailscale-serve` (root) serves the
  `/tutor` build that `just service-install` installs. `nix/package.nix`
- **Git LFS is undocumented and not in the dev shell**: a clone without LFS, or a
  flake input by git ref, builds pointer stubs into the binary as dictionary and
  font data with no error. Add `git-lfs` and a build-time assertion.
- `uv sync` at startup is unlocked and needs network; the model fetch list is
  unpinned and duplicated from `models.py`; the dependency hash in
  `nix/package.nix` is maintained by hand; nix-darwin activation scripts with
  custom names probably never run.
- `flake.nix` is `aarch64-darwin` only (no dev shell on Linux) and
  `nix flake check` is an `echo`.

## 3. Performance

- `talentView` rescans `action_progress` once per skill (26 reads);
  `loadPlayerCtx` reads talents three times. `srv/services/talents.ts`,
  `srv/services/context.ts`
- `actionsForSkill` filters and sorts all 146 actions on every call (25× per
  bonus computation). Cache a `Map<SkillId, ActionDef[]>`.
- Combat loads every card and SRS row to produce a count, and builds the drill
  context twice per hit. `srv/routes/combat.ts`
- `newToday` groups a user's whole review history per practice step; a
  `HAVING min(created_at) >= ?` does it in SQL. `srv/db/repo/reviews.ts`
- Per review: `readStudyPrefs` is 8 single-key queries, called twice;
  `checkLessonCompletion` reloads the deck and the SRS map.
- `dueRigAlerts` scans `action_progress` every minute with no covering index.
- Migration 0020 added six indexes that duplicate the leading column of a primary
  key, and `idx_xp_user` duplicates `idx_xp_events_user`.
- The model list is refetched per `/api/models` call (the cache is per instance);
  the frequency list is re-downloaded per build and growth batch.
- Anki import inflates the whole archive, media included, twice.
- Web: the service worker precaches ~9 MB of CJK fonts on every deploy and then
  reloads the page mid-session; four pages run their own 250 ms ticker even with
  no rig running.

## 4. Refactors worth scheduling

1. **Event bus hygiene.** The bus is the planned extension point (DESIGN §11.4)
   but has no production subscribers yet. Today every grant runs an extra
   `getItemCount` to fill an event nobody reads, and events fire inside a
   transaction before it commits. Collect events during a use case and flush them
   after commit.
2. **Gear ownership has two sources of truth** (`inventory.count` and
   `gear_instances`). Derive the equipment count from instances.
3. **The drizzle schema is missing what the SQL relies on**: composite primary
   keys on seven tables and the unique username index exist only in migrations.
   Declare them, and add a test diffing `sqlite_master` against the schema.
4. **Over-fragmentation from the 20-line rule.** `combatResolve.ts` moves one
   exchange through nine single-use interfaces; `practice/next.ts` re-packs one
   request through four types. Consider a 30–40 line budget with complexity as
   the real limit.
5. **Same-typed positional ids** caused two shipped bugs (swapped `deckId`/
   `userId`, swapped `slot`/`instanceId`). Branded id types or options objects.
6. **Duplicated helpers that have diverged**: four reading-key mappers (they
   disagree on Cantonese and pinyin), five text normalisers, three copies of the
   level curve, three of the gateway call.
7. **Web data layer**: the "peek cache → state → fetch → loading/error" block is
   hand-copied on ten pages and `/api/skills` is fetched and re-indexed by six.
   One `cachedResource` helper, a shared skills store and a shared clock would
   give the race, 401 and cache fixes in §2 a single home.
8. **Misplaced modules**: `seed/zhuyin.ts`, `seed/furigana.ts` and the lexicon in
   `seed/frequency.ts` are runtime utilities, not seed data; service-level tests
   live in `game/` (`*service.test.ts`); the API tests sit loose in `srv/`.
9. **Dead packages**: `packages/speech` (the server hand-rolls the same calls in
   four places) and `packages/ui` (one constant). Adopt or delete.
10. **Inconsistent HTTP errors**: two `GuardError` types, the "No OpenRouter key"
    guard copy-pasted six times (as a 502), `ok: false` under HTTP 200.
11. **Quality gates**: no CI and no pre-commit hook (wire in `just ci`); knip
    never fails (71 exports are still over-exported); nothing lints or tests the
    Python; ESLint is not type-aware (no `no-floating-promises`).
12. **Docs and config**: `.env.example` is missing ~20 variables the code reads;
    there is no LICENSE or NOTICE for the bundled CC-licensed dictionary data;
    `design/tutor/` is a static prototype with its own, older palette
    (`design/tutor/DESIGN.md`) that disagrees with the shipped one (root
    `DESIGN.md`) — archive or delete it.
