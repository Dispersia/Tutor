import { VOICES, type Voice } from '@tutor/core'

export type CardVoice = Voice

export const CARD_VOICES: readonly CardVoice[] = VOICES

export function voiceAt(index: number): CardVoice {
  const n = CARD_VOICES.length
  const i = ((Math.trunc(index) % n) + n) % n
  return CARD_VOICES[i]!
}
