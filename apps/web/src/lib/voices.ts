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

/**
 * The style every deck's audio uses. The listening template must sound like one
 * teacher across the whole deck, and must say only the text it was given — a
 * single word on a vocab card, a whole sentence on a sentence card.
 */
export const TEACHER_INSTRUCT =
  'Speak like a calm, professional language teacher: clear and precise articulation, ' +
  'warm and friendly, steady measured pace, natural intonation. Read exactly the text ' +
  'given — a single word or one whole sentence — and do not add, repeat or translate any words.'

export interface VoicePrefs {
  mode: 'preset' | 'design'
  voices: Record<string, string>
}

/**
 * The learner's saved voice choices. Playback reads this at call time, so a
 * change saved in Settings applies to the next clip without a reload. In design
 * mode the per-language string is a *voice description*; in preset mode it is a
 * speaker name.
 */
let prefs: VoicePrefs = { mode: 'preset', voices: {} }

export function setVoicePrefs(next: Partial<VoicePrefs> | null | undefined): void {
  prefs = {
    mode: next?.mode === 'design' ? 'design' : 'preset',
    voices: next?.voices && typeof next.voices === 'object' ? { ...next.voices } : {},
  }
}

export function getVoicePrefs(): VoicePrefs {
  return prefs
}

export function voiceFor(lang: string | null | undefined, overrides = prefs.voices) {
  if (lang && overrides[lang]) return overrides[lang]
  return lang ? PRESET_VOICES[lang] : undefined
}

/**
 * The payload every `speak`/`createSpeaker` call should use, so the learner's
 * voice mode is never ignored: preset mode sends a speaker name, design mode
 * sends the saved description as the style instruction.
 */
export function speechOpts(lang: string | null | undefined): {
  language?: string
  mode: 'preset' | 'design'
  voice?: string
  instruct: string
} {
  if (!lang) return { mode: prefs.mode, instruct: TEACHER_INSTRUCT }
  if (prefs.mode === 'design') {
    return {
      language: lang,
      mode: 'design',
      instruct: prefs.voices[lang] || TEACHER_INSTRUCT,
    }
  }
  return {
    language: lang,
    mode: 'preset',
    voice: voiceFor(lang),
    instruct: TEACHER_INSTRUCT,
  }
}