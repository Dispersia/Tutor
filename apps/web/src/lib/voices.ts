import { randomVoice } from '@tutor/core'

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

export function speechOpts(lang: string | null | undefined): {
  language?: string
  instruct: string
} {
  return { language: lang ?? undefined, instruct: randomVoice().instruct }
}
