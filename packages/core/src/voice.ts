export type VoiceGender = 'female' | 'male'

export interface Voice {
  id: string
  gender: VoiceGender
  label: string
  instruct: string
}

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

export function randomVoice(rand: () => number = Math.random): Voice {
  return VOICES[Math.floor(rand() * VOICES.length) % VOICES.length]!
}

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

export function voiceInstruct(description: string, lang: string | null | undefined): string {
  const accent = lang ? ACCENTS[lang] : undefined
  return accent ? `${description} ${accent}` : description
}
