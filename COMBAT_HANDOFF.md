# Combat changes — handoff

Resume in a new session. Everything below is **uncommitted**; the working tree also
contains unrelated changes from other sessions (see "Unrelated changes" at the end).

Discord thread: https://discord.com/channels/1546033374852816956/1571668823776567459

## What the user asked for

1. "combat should only do review cards."
2. "Fighting something should use what equipment you have, so if you have a sword,
   you get strength, bow is ranged, staff is sorcery. You shouldn't have to choose
   which to use."
3. "Defence and constitution get leveled when you get hit."
4. "it doesn't seem like i ever get hit right now." (investigation — not conclusively solved)
5. "there should be a timer in combat for you to enter it correctly, but you have to
   hit 'start' for the first one to get it going. its like a time attack."

## Status: implemented, tests + typecheck + svelte-check pass

### 1. Combat is review-only

- `apps/server/src/routes/combat.ts` → `buildDrill()` now uses `pickReviewCard`
  (cards that already have an SRS state) instead of `pickCard`. Prefers the
  monster's deck, falls back to any reviewed card (Anki imports have no level).
- `countReviewCards()` gates `/api/combat/start`; with 0 review cards the route
  returns 409 and the page shows "practise first".
- `CombatResponse.reviewCount` added to `apps/web/src/lib/combat.ts` and rendered
  in the monster list.

### 2. Weapon decides the combat skill (no manual choice)

- New `weaponSkill(tags)` in `apps/server/src/game/skills.ts`:
  `bow → ranged`, `staff → magic`, else `strength`.
- `getPlayerCombat()` in `apps/server/src/game/service.ts` derives `skill` and
  `power` from the **equipped weapon**; returns it in `HitOutcome.skill` and the
  `/api/combat` response (`player.skill`).
- Per-monster gates removed: `MonsterDef.combatSkill`, `requires`, `equip` deleted
  from `apps/server/src/game/combat.ts`. `monsterState()` always returns unlocked.

### 3. Defence + Constitution XP on being hit

- `combatResolve()` in `apps/server/src/game/service.ts` awards
  `defenceXp` / `constitutionXp` (scaled to damage taken) via `awardActionXp`.
- `HitOutcome` extended with `defenceXp` and `constitutionXp`; the page shows
  chips for both.

### 4. Time attack

- `COMBAT_TIME_LIMIT_MS = 20_000` in `apps/web/src/lib/combat.ts`.
- `apps/web/src/routes/(app)/combat/+page.svelte`:
  - `timerStarted` / `deadline` / `now` / `timeoutFired` state, 100ms tick `$effect`.
  - First drill of a fight shows a **Start** gate (`data-enter-action`, so Enter works);
    each following drill auto-starts its clock after the previous hit lands.
  - On timeout → `submit(null, true)` → `combatHit({ ..., timedOut: true })`.
- Server: `/api/combat/hit` accepts `timedOut?: boolean` and grades it as a forced
  miss (score 0, feedback "Out of time — the monster strikes.") without grading
  the answer.

### 5. "Never gets hit" investigation

- Confirmed the miss path works: `a missed drill lets the monster hit back…` test
  in `apps/server/src/combatapi.test.ts` asserts `playerDamage > 0`, HP drops, and
  Defence/Constitution XP > 0.
- **Not reproducible from local data.** `data/tutor.db` is seed-ish: 19 reviews all
  `multiple_choice` score 100 / latency 0, one `slime` encounter with `player_hp 12`
  of `player_max_hp 24`, no equipment row. Not reliable evidence of real user play.
- Likely real-world explanation: with no weapon equipped and low monster damage,
  auto-eat + high max HP hides chip damage, and a wrong `multiple_choice` answer is
  the only way to get hit. Timeouts (new) add a second way to be hit.
- **Open question for the next session:** whether to make hits more noticeable
  (monster damage vs. armour, auto-eat threshold, or first-hit feedback).

## Files touched (combat work only)

```
apps/server/src/game/combat.ts                     gates removed, header
apps/server/src/game/service.ts                    getPlayerCombat, monsterState, combatResolve
apps/server/src/game/skills.ts                     weaponSkill, oak_staff, fletch-staff
apps/server/src/routes/combat.ts                   review-only + timedOut
apps/server/src/routes/practice.ts                 pickReviewCard (pre-existing helper)
apps/server/src/combatapi.test.ts                  miss + timeout API tests
apps/server/src/game/combat.test.ts                unit tests
apps/server/src/game/combatservice.test.ts         unit tests
apps/web/src/lib/combat.ts                         DTOs, COMBAT_TIME_LIMIT_MS, timedOut
apps/web/src/routes/(app)/combat/+page.svelte      time attack UI
docs/DESIGN.md                                     §13.5 combat text
```

## Verify

```bash
bun run typecheck
bun run --cwd apps/web check
bun test apps/server/src/combatapi.test.ts apps/server/src/game/combat.test.ts apps/server/src/game/combatservice.test.ts
bunx prettier --check 'apps/web/src/routes/(app)/combat/+page.svelte' apps/web/src/lib/combat.ts apps/server/src/routes/combat.ts apps/server/src/combatapi.test.ts
```

Last run: typecheck clean, svelte-check 0 errors/0 warnings, combat tests pass,
prettier clean. Full `bun test` was ~216 pass / 0 fail before the temp tests were
deleted (temp `apps/server/src/tmp-*.test.ts` files were removed).

## Next steps

1. Decide balance: make monster hits noticeable (damage vs. armour, auto-eat
   threshold, or a first-hit animation/float).
2. Confirm timer duration (20s) and whether the Start gate should appear once per
   fight or once per session.
3. Commit — nothing here is committed yet. Filter to the combat files above;
   the tree also has unrelated cross-session edits.

## Unrelated changes in the working tree (NOT this work)

`DESIGN.md` (root), `README.md`, `apps/server/src/app.test.ts`,
`apps/server/src/context.ts`, `apps/server/src/deck/pitch.ts` (new),
`apps/server/src/deckapi.test.ts`, `apps/server/src/routes/decks.ts`,
`apps/server/src/routes/stats.ts`, `apps/server/src/static.ts`,
`apps/web/...` (DeckSettings, bank page, Icon, layout, chat, exercises, app.html),
`scripts/backfill-pitch.ts` (new).
