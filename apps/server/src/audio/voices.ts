/**
 * The recorded voice set for listening cards.
 *
 * VoxCPM2 has no named speakers: a clip's voice is *described* in words via the
 * `instruct` argument (DESIGN §4.2 / §9.2). So the card audio is pre-rendered in
 * four voices — a teenager and a teacher of each gender. The learner hears a
 * random one per play, so they never overfit to a single speaker, and playback
 * is a plain file stream (no TTS, no model wake).
 *
 * The set is fixed and shared with live playback (`@tutor/core`): audio is
 * content, not a learner preference, so clips can be shared between cards that
 * carry the same text. Four voices keep a full-library backfill to a few hours.
 */

import { VOICES, type Voice } from '@tutor/core'

export type CardVoice = Voice

/** The recorded set: the app's four voices (`@tutor/core`), shared with live playback. */
export const CARD_VOICES: readonly CardVoice[] = VOICES

/** Clamps an arbitrary index to a real voice (negative wraps, out of range wraps). */
export function voiceAt(index: number): CardVoice {
  const n = CARD_VOICES.length
  const i = ((Math.trunc(index) % n) + n) % n
  return CARD_VOICES[i]!
}
