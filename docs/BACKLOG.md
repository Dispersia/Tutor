# Backlog — open defects and refactors

**Remove an item when it is fixed**; what was fixed is in git history, not here.
`srv/` is `apps/server/src/`, `web/` is `apps/web/src/`.

## 1. Do once on the Mac (never run for real)

Everything here passes its tests but has only met fakes.

1. **Back up `tutor.db`**, then start the new build. It applies migrations 0021
   (lessons keyed by deck id), 0022 (private cards) and 0027 (drops the dead
   `attempts` table and five write-only columns), plus a one-time startup step
   that turns legacy equipment counts into gear pieces.
2. **Update the Nix dependency hash.** `packages/speech` and `packages/ui` were
   removed, which changes what the dependency derivation produces. If
   `just package` reports a hash mismatch, paste the hash it prints into
   `outputHash` in `nix/package.nix`.
3. **The speech gateway (`python/speech/server.py`)**: temp-file cleanup, sync
   upload handlers, the upload and text size caps, the `reference` field on
   `/v1/asr`, and the new `/admin/shutdown`. No Python or MLX ran on the review
   machine. Exercise `/v1/asr`, `/v1/assess` and `/v1/tts` once. (The dead
   `/v1/align` route and the never-loaded VAD checkpoint are gone; the aligner
   itself is still used by `/v1/assess`.)
4. **Clip grading** against the real recogniser: watch `rejected` in
   `GET /api/audio/status` and the `[audio] take n/3 … said …` log lines after the
   next backfill — they are the per-language pass rate.
5. **The per-language accent**: voices ask for one (`packages/core/src/voice.ts`);
   nobody has listened to confirm the model honours it.
6. **The rewritten prompts**: no real model call was made. Grow one deck by a
   batch and hold one voice chat.
7. **The web app in a browser.** Nothing was run in one. In particular:
   - every page opens (the shared skills store writes state while a page starts;
     a `state_unsafe_mutation` error would point at `web/lib/skills/store.svelte.ts`);
   - the mic is released when leaving Chat mid-recording;
   - an expired session redirects to login;
   - the service worker: offline open, notification click, the reload after a deploy;
   - the four dialogs now trap focus and restore it — confirm on a phone.
8. **CI**: `.github/workflows/ci.yml` runs `bun run verify` on push. It has not
   run yet; it needs Git LFS available to the runner.

## 2. Decide

1. **Combat feel**: are monster hits noticeable enough (damage vs armour, the
   auto-eat threshold, first-hit feedback)? Is 20 s the right drill timer, and
   should Start gate each fight or each session?
2. **Sentence-build grading is stricter than the rest**: it compares
   case-sensitively and strips less punctuation than the other drills
   (`sentenceKey` vs `bareText` in `srv/text/normalize.ts`). Kept as it was.
3. **The size budget.** Twenty lines per function is enforced everywhere, and in
   places it has produced plumbing rather than clarity (`combatResolve.ts`,
   `practice/next.ts`). Raising it to 30–40 with a complexity limit is a policy
   change, so it was not made.

## 3. Bugs

### Server

- **Combat's time limit is client-asserted.** The drill itself is now bound to
  the fight, but `timedOut` comes from the client: the first drill of a fight
  waits for the player's Start click, so the server cannot know its deadline.
  `srv/routes/combat.ts`
- **Old audio for shared words**: a clip recorded before clips were keyed by
  language is dropped the first time either language asks for it, then
  re-recorded on demand. Expected; listed so the re-recording is not a surprise.
- **Clips recorded before grading existed were never checked**, and live
  playback (chat replies, "hear it" on a card) is not graded. If a language
  rejects often, record the word three times in one take and cut out the middle
  one with the aligner (not built).
- **`equipment.instance_id` is still nullable** in the schema, though nothing
  writes null any more.
- **Chat sessions are never closed.** `sessions.ended_at` was write-only and was
  dropped with migration 0027, so a conversation stays open forever and History
  has no notion of a finished session.
- **`POST /api/decks` now always builds a path deck** (so it needs a key); only
  the `instruction` branch still creates a deck from a prompt, and there is no
  way to create an empty deck through the API any more.
- **FSRS `EASY` is unreachable in production**: `ratingFromScore` answers
  AGAIN/HARD/GOOD, and the `EASY` branches in `schedule()` are only exercised by
  tests. Every drill scores at most 100, and a perfect score is deliberately
  `GOOD` so a new card still graduates on its second answer.

### Web

- **The in-app IME (§14.3) has never run in a browser.** No device testing: the
  composition is unit-tested (`apps/web/src/lib/ime/*.test.ts`) but the keyboard,
  the candidate bar and the readonly-field handoff are not.
- **The Japanese engine is romaji-only.** A 12-key flick layout is what a phone
  expects; the romaji QWERTY is mozc's desktop mode.
- **Sentence conversion is one shot.** There is no user dictionary, no per-segment
  editing and no way to re-convert one word inside a sentence — you pick a
  whole-sentence candidate or edit after committing. Chinese segments by the
  curated/lexicon rank (tones optional); Japanese takes the longest kana match, so
  a compound missing from the lexicon can lose to a shorter word.
- **The zh engine always offers Traditional bopomofo.** A Simplified deck still
  gets Traditional candidates — the reverse index only holds the MOE readings.
- **Candidate ranking falls back to dictionary order** for words outside the
  curated lists and the deck lexicon (`ime/candidates.ts`); a bundled frequency
  list would order them better.
- **Haptics are Android-only** (`navigator.vibrate`); iOS Safari ignores them, so
  the slider does nothing there. The setting was never felt on a device. They fire
  on answer, retry and next taps in practice and combat, and on the in-app IME
  keypad.
- **The IME field is `readonly` with `inputmode="none"`** (`ime/ImeInput.svelte`),
  so paste, caret movement and text selection are lost inside it.

### Speech gateway (`python/speech`)

- **The TTS runaway cap is dead**: `tts_synthesize` accepts `max_tokens`, `voice`,
  `language`, `mode`, `temperature` and forwards only `text` and `instruct`.
  Needs the model's real parameter names, checked on the Mac. `models.py`
- **Lock scope**: `get()` holds the manager lock for a whole model load, so
  `/health` hangs during a cold start; unload and cache-clear can run beside an
  inference. `models.py`
- An ffmpeg failure passes the raw upload on instead of answering 400.

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

## 4. Performance

- Combat builds the drill context twice per hit (grade, then the next drill).
  `srv/routes/combat.ts`
- `checkLessonCompletion` reloads the deck and the SRS map on every review.
  `srv/services/curriculum.ts`
- `loadPlayerCtx` still reads `action_progress` in the settle, the progress view
  and the band view.

## 5. Refactors worth scheduling

1. **Over-fragmentation** (see §2.3): `combatResolve.ts` moves one exchange
   through nine single-use interfaces.
2. **A few direct reading-key reads remain** outside `text/readings.ts`:
   `srv/deck/pitch.ts`, `srv/audio/service.ts`, `srv/routes/audio.ts`.
3. **Quality gates**: knip never fails (unused exports are advisory); nothing
   lints or tests the Python; ESLint is not type-aware (no
   `no-floating-promises`); there is no pre-commit hook.
4. **Docs**: `design/tutor/` is a static prototype with an older palette than the
   shipped one — archive or delete it. `.impeccable/design.json` (design-tool
   state) is tracked while `.impeccable/review/` is ignored. `NOTICE.md` says the
   bundled fonts are under the SIL Open Font License from memory; confirm against
   each family's licence file.
