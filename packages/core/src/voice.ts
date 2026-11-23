/**
 * The voice the speech model speaks in, shared by the server (recorded card
 * audio) and the web app (live playback) so both sound the same.
 *
 * VoxCPM2 has no named speakers and no language parameter: a voice is
 * *described* in words, and the language is inferred from the text. So the
 * accent is part of the description. The text itself is always spoken as
 * written: a Japanese word keeps its kanji, because the kanji is what tells the
 * model which word it is — and so which pitch accent — where kana alone cannot
 * (橋 and 箸 are both はし).
 * There are no user settings here: four fixed voices, the same in every language.
 */

export type VoiceGender = 'female' | 'male'

export interface Voice {
  /** Stable id — part of a recorded clip's key, so never rename one. */
  id: string
  gender: VoiceGender
  /** Short human label, for status/debug UI. */
  label: string
  /** The voice described in words: age, timbre and delivery. */
  instruct: string
}

/**
 * The four voices: a teenager and a teacher of each gender. A learner who hears
 * a word from a young, quick voice and from an older, measured one learns the
 * word rather than one speaker's way of saying it.
 */
export const VOICES: readonly Voice[] = [
  {
    id: 'f1',
    gender: 'female',
    label: 'Female — teen',
    instruct:
      'A teenage girl with a bright, light, youthful voice. Clear articulation, ' +
      'a cheerful and friendly tone, a natural conversational pace.',
  },
  {
    id: 'f2',
    gender: 'female',
    label: 'Female — teacher',
    instruct:
      'A woman in her forties, a language teacher, with a warm, lower-pitched voice. ' +
      'Clear and precise articulation, a calm and patient tone, a steady measured pace.',
  },
  {
    id: 'm1',
    gender: 'male',
    label: 'Male — teen',
    instruct:
      'A teenage boy with a light, youthful voice. Clear articulation, ' +
      'an easy and friendly tone, a natural conversational pace.',
  },
  {
    id: 'm2',
    gender: 'male',
    label: 'Male — teacher',
    instruct:
      'A man in his forties, a language teacher, with a deep, warm voice. ' +
      'Clear and precise articulation, a calm and patient tone, a steady measured pace.',
  },
]

/** A voice for one live clip or one chat reply, picked at random. */
export function randomVoice(rand: () => number = Math.random): Voice {
  return VOICES[Math.floor(rand() * VOICES.length) % VOICES.length]!
}

/**
 * The accent each language is spoken in. Written in the language itself where
 * the model documents that (Chinese dialect names), in English otherwise.
 */
const ACCENTS: Record<string, string> = {
  zh: 'Speaks Mandarin Chinese with a standard Taiwanese accent (台灣國語).',
  yue: 'Speaks Cantonese (粵語，廣東話) with a Hong Kong accent.',
  ja: 'Speaks standard Japanese (Tokyo accent).',
  ko: 'Speaks standard Korean (Seoul accent).',
  de: 'Speaks standard German (Hochdeutsch).',
  es: 'Speaks neutral Latin American Spanish.',
  fr: 'Speaks standard French (Paris accent).',
  it: 'Speaks standard Italian.',
  pt: 'Speaks Brazilian Portuguese.',
  ru: 'Speaks standard Russian (Moscow accent).',
  en: 'Speaks General American English.',
}

/** A voice description with the language's accent appended. */
export function voiceInstruct(description: string, lang: string | null | undefined): string {
  const accent = lang ? ACCENTS[lang] : undefined
  return accent ? `${description} ${accent}` : description
}
