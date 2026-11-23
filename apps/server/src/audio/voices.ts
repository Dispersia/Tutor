/**
 * The recorded voice set for listening cards.
 *
 * VoxCPM2 has no named speakers: a clip's voice is *described* in words via the
 * `instruct` argument (DESIGN §4.2 / §9.2). So the card audio is pre-rendered in
 * four voices — two female and two male, each end of the range deliberately
 * pitched high and low — from these descriptions. The learner hears a random one
 * per play, so they never overfit to a single speaker, and playback is a plain
 * file stream (no TTS, no model wake).
 *
 * Unlike the tutor's chat voice (`apps/web/src/lib/voices.ts`) this set is fixed:
 * listening audio is content, not a learner preference, so every card in every
 * deck sounds the same and the clips can be shared (content-addressed) between
 * cards that carry the same `back` text. Four voices keep a full-library backfill
 * to a few hours while still spanning high/low and female/male.
 */

export type VoiceGender = 'female' | 'male'

export interface CardVoice {
  /** Stable id — part of the clip hash, so never rename an existing one. */
  id: string
  gender: VoiceGender
  /** Short human label, for status/debug UI. */
  label: string
  /** VoxCPM2 voice-design description (pitch, timbre, delivery). */
  instruct: string
}

/**
 * Four voices — high and low for each gender. The pitch wording is the whole
 * point: it spreads the set across a wide range so the same word is heard from
 * noticeably different speakers.
 */
export const CARD_VOICES: readonly CardVoice[] = [
  {
    id: 'f1',
    gender: 'female',
    label: 'Female — high, bright',
    instruct:
      'A young woman with a very high, bright, airy voice. Clear and precise articulation, ' +
      'a warm and friendly tone, a steady measured pace and natural intonation.',
  },
  {
    id: 'f2',
    gender: 'female',
    label: 'Female — low, deep',
    instruct:
      'An older woman with a low, deep and resonant voice. Clear and deliberate ' +
      'articulation, a calm and warm tone, a steady measured pace and natural intonation.',
  },
  {
    id: 'm1',
    gender: 'male',
    label: 'Male — high, light',
    instruct:
      'A young man with a high, light tenor voice. Clear and precise articulation, ' +
      'a bright and friendly tone, a steady measured pace and natural intonation.',
  },
  {
    id: 'm2',
    gender: 'male',
    label: 'Male — low, bass',
    instruct:
      'An older man with a very deep, resonant bass voice. Clear and deliberate ' +
      'articulation, a slow and warm tone, natural intonation.',
  },
] as const

/** Clamps an arbitrary index to a real voice (negative wraps, out of range wraps). */
export function voiceAt(index: number): CardVoice {
  const n = CARD_VOICES.length
  const i = ((Math.trunc(index) % n) + n) % n
  return CARD_VOICES[i]!
}
