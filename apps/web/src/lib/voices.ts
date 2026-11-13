/** Qwen3-TTS CustomVoice presets per language. */
export const PRESET_VOICES: Record<string, string> = {
  zh: 'Serena',
  yue: 'Serena',
  ja: 'Ono_Anna',
  ko: 'Sohee',
  en: 'Ryan',
}

export const VOICE_PRESETS: Record<string, string[]> = {
  zh: ['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric'],
  en: ['Ryan', 'Aiden'],
  ja: ['Ono_Anna'],
  ko: ['Sohee'],
}

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

export function voiceFor(lang: string | null | undefined, overrides: Record<string, string> = {}) {
  if (lang && overrides[lang]) return overrides[lang]
  return lang ? PRESET_VOICES[lang] : undefined
}
