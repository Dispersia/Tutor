/**
 * Voice handling for the local TTS (VoxCPM2).
 *
 * VoxCPM2 has no named voices: every clip is either the checkpoint's zero-shot
 * voice or the voice you *describe* in words (its `instruct` argument). So the
 * app has two modes — a built-in voice styled as a calm teacher, and a
 * per-language description the learner writes.
 */
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
 * The built-in voice. The listening template must sound like one teacher across
 * the whole deck, and must say only the text it was given — a single word on a
 * vocab card, a whole sentence on a sentence card.
 */
export const TEACHER_INSTRUCT =
  'A calm, professional language teacher with clear and precise articulation, ' +
  'a warm and friendly tone, a steady measured pace and natural intonation.'

export interface VoicePrefs {
  mode: 'preset' | 'design'
  voices: Record<string, string>
}

/**
 * The learner's saved voice choices. Playback reads this at call time, so a
 * change saved in Settings applies to the next clip without a reload. In design
 * mode the per-language string is a *voice description*; in preset mode the
 * built-in teacher voice is used.
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

/**
 * The payload every `speak`/`createSpeaker` call should use, so the learner's
 * voice mode is never ignored. Both modes carry an `instruct`: preset sends the
 * built-in teacher description, design sends the learner's own.
 */
export function speechOpts(lang: string | null | undefined): {
  language?: string
  mode: 'preset' | 'design'
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
  return { language: lang, mode: 'preset', instruct: TEACHER_INSTRUCT }
}
