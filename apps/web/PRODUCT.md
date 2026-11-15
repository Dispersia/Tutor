# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A household sharing one self-hosted tutor on an Apple Silicon Mac. Members sign
in with local accounts, each with their own settings, model choice and history.

Primary usage scene: **phone on the couch** — one-handed, short, frequent
sessions, usually daily, often interrupted. Desktop is the secondary scene
(longer practice, setup, reviewing history). Household size and account count
are undecided; do not design for a specific number.

The person setting it up once is not the same as the person using it daily:
setup and administration may happen on desktop, while everyday use is mobile.

## Product Purpose

A conversation-first language tutor: the member talks or types to an AI tutor,
hears it answer out loud, and is drilled with cards that range from single-word
recall to spoken sentences with pronunciation feedback. It exists to give a
household a daily-practice language app that is not canned multiple-choice and
does not ship their voice to a cloud service.

Success means members open it on their own, repeatedly, without being nagged,
and their progress and history are still there months later.

## Positioning

The brain is OpenRouter (the household's own key, model chosen per role), the
speech is local Qwen3 on MLX, and audio never leaves the Mac. That combination —
conversation-level drills, local speech, bring-your-own model, permanent local
history — is the claim a neighboring language app could not truthfully copy.

## Operating Context

- The Mac is the server; phones are the clients over LAN/tailnet HTTPS (the mic
  requires a secure context).
- Speech models are loaded on demand and **unload when idle** so the machine
  gets its RAM back; members see a brief "waking up" state.
- Each member supplies or inherits an OpenRouter key; roles (conversation,
  judge, generator, translator) can use different models.
- Daily loop: streak, XP, daily goal, then a next exercise chosen by the
  curriculum; longer sessions go to chat/voice conversation.
- Practice spans Mandarin (HSK 1) and Japanese (JLPT N5) with furigana/zhuyin
  reading aids; more languages are content, not architecture.
- History is permanent and replayable; audio may be retained indefinitely
  (retention policy undecided).

## Capabilities and Constraints

Confirmed capabilities: chat and voice conversation with streamed replies and
per-sentence TTS; six exercise types rendered by a registry keyed on `id`;
pronunciation scoring (ASR + forced aligner, optional LLM judge); cards and
decks (frequency, HSK 1, JLPT N5, AI-generated); spaced repetition and an n+1
frequency path with sentence building; XP/levels/UTC streaks/daily goal;
professions, talents, materials, gear and combat; per-member history and
settings; admin account management.

Binding constraints:

- **No cloud speech.** Local models only; this is the product's privacy claim.
- **Apple Silicon Mac, 16 GB.** Models must stay under roughly 7 GB resident and
  unload when idle; the UI must tolerate cold starts.
- **Mobile-first PWA** served as a static shell by the Bun API; offline shell for
  history/settings, speech needs the Mac.
- Local accounts only (argon2id), fully isolated per member; first user is admin.
- Adding an exercise type must stay backend `ExerciseDef` + one Svelte component
  keyed by the same `id`; adding a profession must stay content-only.
- Existing API contracts and data model described in `../../docs/DESIGN.md` are
  authoritative; visual redesign does not license changing them.

Explicitly free to change (not constraints): name `tutor`, dark theme, palette,
typography, density, navigation labels, and the existing decorative accent
treatments.

Undecided: household size, audio retention policy, default model ids per role,
default voice per language.

## Brand Commitments

No binding identity: the household has agreed the name, logo, voice and visual
identity may change. No existing brand assets or voice identity must be
preserved.

## Evidence on Hand

Real content in the repo, usable in the product: frequency, HSK 1 and JLPT N5
seed decks (`apps/server/src/seed/`), the exercise registry, and the
pronunciation/speech pipeline. No testimonials, customer logos, benchmarks,
pricing or press exist — future work must not fabricate any.

## Product Principles

1. **Conversation beats quiz UI.** Every screen serves speaking, listening or
   producing language, not tapping through canned options.
2. **Local-first by default.** Voice, keys and history stay on the household
   machine; never add a cloud dependency that silently breaks that promise.
3. **Fits a couch minute.** The default path is one-handed, interruptible and
   resumable; desktop gets more room, not a different product.
4. **History is the product.** Progress, mistakes and recordings persist and stay
   reviewable; nothing important is ephemeral.
5. **Extensible without rewrites.** New exercises, languages and game systems are
   additions, never core surgery.