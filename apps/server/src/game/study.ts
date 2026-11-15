import type { Db } from '../db/client'
import { getUserSetting, setUserSetting } from '../db/repo'

/**
 * Per-user study preferences (docs/DESIGN.md §13.8). These shape how decks are
 * drilled without touching the decks themselves:
 *
 * - which native readings are shown (Zhuyin for Chinese, furigana for Japanese),
 * - which exercise kinds are offered at all (e.g. turn speaking/listening off).
 *
 * Stored as plain `user_settings` key/value rows, so no migration is needed and
 * everything stays scoped to the signed-in user.
 */
export interface StudyPrefs {
  /** show Zhuyin under Chinese characters */
  showZhuyin: boolean
  /** show furigana over Japanese kanji */
  showFurigana: boolean
  /** exercise ids the learner turned off (empty = every kind is offered) */
  disabledExercises: string[]
}

export const DEFAULT_STUDY_PREFS: StudyPrefs = {
  showZhuyin: true,
  showFurigana: true,
  disabledExercises: [],
}

const KEYS = {
  showZhuyin: 'study.showZhuyin',
  showFurigana: 'study.showFurigana',
  disabledExercises: 'study.disabledExercises',
} as const

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback
  return raw !== '0' && raw !== 'false'
}

/** Reads a user's study preferences, falling back to the defaults. */
export function readStudyPrefs(db: Db, userId: string): StudyPrefs {
  let disabled: string[] = []
  const raw = getUserSetting(db, userId, KEYS.disabledExercises)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) disabled = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      disabled = []
    }
  }
  return {
    showZhuyin: bool(getUserSetting(db, userId, KEYS.showZhuyin), DEFAULT_STUDY_PREFS.showZhuyin),
    showFurigana: bool(
      getUserSetting(db, userId, KEYS.showFurigana),
      DEFAULT_STUDY_PREFS.showFurigana,
    ),
    disabledExercises: disabled,
  }
}

/** Applies a partial update and returns the full, stored preferences. */
export function writeStudyPrefs(db: Db, userId: string, patch: Partial<StudyPrefs>): StudyPrefs {
  if (patch.showZhuyin !== undefined) {
    setUserSetting(db, userId, KEYS.showZhuyin, patch.showZhuyin ? '1' : '0')
  }
  if (patch.showFurigana !== undefined) {
    setUserSetting(db, userId, KEYS.showFurigana, patch.showFurigana ? '1' : '0')
  }
  if (patch.disabledExercises !== undefined) {
    setUserSetting(db, userId, KEYS.disabledExercises, JSON.stringify(patch.disabledExercises))
  }
  return readStudyPrefs(db, userId)
}

/**
 * Whether native readings should be shown for a target language. Chinese shows
 * Zhuyin, Japanese shows furigana; any other language keeps its reading.
 */
export function showsReadings(prefs: StudyPrefs, targetLang: string): boolean {
  if (targetLang === 'zh' || targetLang === 'yue') return prefs.showZhuyin
  if (targetLang === 'ja') return prefs.showFurigana
  return true
}
