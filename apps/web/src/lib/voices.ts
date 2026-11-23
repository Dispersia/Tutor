/** Language names for the UI, and the voice live playback speaks in. */

import { randomVoice, voiceInstruct } from '@tutor/core'

export const LANG_NAMES: Record<string, string> = {
  zh: 'Mandarin',
  yue: 'Cantonese',
  ja: 'Japanese',
  ko: 'Korean',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
}

/**
 * The payload for one `speak`/`createSpeaker` call: one of the app's four voices
 * (picked per call, so a chat reply keeps one voice from start to end), in the
 * language's own accent. There is nothing for the learner to configure.
 */
export function speechOpts(lang: string | null | undefined): {
  language?: string
  instruct: string
} {
  return { language: lang ?? undefined, instruct: voiceInstruct(randomVoice().instruct, lang) }
}
