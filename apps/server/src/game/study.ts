import type { Db } from '../db/client'
import { getUserSetting, setUserSetting } from '../db/repo'

/**
 * Per-user study preferences (docs/DESIGN.md §13.8). These shape how decks are
 * drilled without touching the decks themselves:
 *
 * - which native readings are shown (Zhuyin for Chinese, furigana for Japanese),
 * - which exercise kinds are offered at all (e.g. turn speaking/listening off),
 * - the daily budget (new cards / reviews per day) and the learning steps that
 *   decide how many times a brand-new card repeats before it graduates.
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
  /** New cards to introduce per UTC day (0 = unlimited). */
  newPerDay: number
  /** Graded reviews allowed per UTC day (0 = unlimited). */
  maxReviewsPerDay: number
  /** Learning steps in minutes; a new card repeats once per step. */
  learningSteps: number[]
  /** Grow the deck automatically when a word keeps lapsing. */
  autoReinforce: boolean
}

export const DEFAULT_STUDY_PREFS: StudyPrefs = {
  showZhuyin: true,
  showFurigana: true,
  disabledExercises: [],
  newPerDay: 20,
  maxReviewsPerDay: 200,
  // Anki's default is two steps (1m, 10m). We keep four so a new word comes
  // back a handful of times in a session instead of twice, then graduating.
  learningSteps: [1, 10, 60, 240],
  autoReinforce: true,
}

const KEYS = {
  showZhuyin: 'study.showZhuyin',
  showFurigana: 'study.showFurigana',
  disabledExercises: 'study.disabledExercises',
  newPerDay: 'study.newPerDay',
  maxReviewsPerDay: 'study.maxReviewsPerDay',
  learningSteps: 'study.learningSteps',
  extraToday: 'study.extraToday',
  autoReinforce: 'study.autoReinforce',
} as const

/** Anki caps the steps at a day; anything longer is not a learning step. */
const MAX_STEP_MINUTES = 24 * 60

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback
  return raw !== '0' && raw !== 'false'
}

function int(raw: string | undefined, fallback: number, lo = 0, hi = 100_000): number {
  const n = Number(raw)
  if (raw === undefined || raw === '' || !Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function parseSteps(raw: string | undefined, fallback: number[]): number[] {
  if (raw === undefined) return [...fallback]
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...fallback]
    const steps = parsed
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= MAX_STEP_MINUTES)
    // An empty list is meaningful: graduate new cards immediately.
    return steps.map((n) => Math.round(n))
  } catch {
    return [...fallback]
  }
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
    newPerDay: int(
      getUserSetting(db, userId, KEYS.newPerDay),
      DEFAULT_STUDY_PREFS.newPerDay,
      0,
      10_000,
    ),
    maxReviewsPerDay: int(
      getUserSetting(db, userId, KEYS.maxReviewsPerDay),
      DEFAULT_STUDY_PREFS.maxReviewsPerDay,
      0,
      100_000,
    ),
    learningSteps: parseSteps(
      getUserSetting(db, userId, KEYS.learningSteps),
      DEFAULT_STUDY_PREFS.learningSteps,
    ),
    autoReinforce: bool(
      getUserSetting(db, userId, KEYS.autoReinforce),
      DEFAULT_STUDY_PREFS.autoReinforce,
    ),
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
  if (patch.newPerDay !== undefined) {
    setUserSetting(db, userId, KEYS.newPerDay, String(Math.max(0, Math.round(patch.newPerDay))))
  }
  if (patch.maxReviewsPerDay !== undefined) {
    setUserSetting(
      db,
      userId,
      KEYS.maxReviewsPerDay,
      String(Math.max(0, Math.round(patch.maxReviewsPerDay))),
    )
  }
  if (patch.learningSteps !== undefined) {
    setUserSetting(db, userId, KEYS.learningSteps, JSON.stringify(patch.learningSteps))
  }
  if (patch.autoReinforce !== undefined) {
    setUserSetting(db, userId, KEYS.autoReinforce, patch.autoReinforce ? '1' : '0')
  }
  return readStudyPrefs(db, userId)
}

// --- today's "study more" overrides -----------------------------------------

/** UTC calendar day (matches the streak / daily-XP granularity). */
function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export interface DailyExtra {
  /** The UTC day these overrides belong to; stale values are ignored. */
  day: string
  /** Extra new cards and reviews the learner asked for today. */
  newExtra: number
  reviewsExtra: number
}

/** The learner's extra allowance for the given UTC day (0 when none/stale). */
export function readDailyExtra(db: Db, userId: string, ts: number = Date.now()): DailyExtra {
  const day = utcDay(ts)
  const raw = getUserSetting(db, userId, KEYS.extraToday)
  if (!raw) return { day, newExtra: 0, reviewsExtra: 0 }
  try {
    const parsed = JSON.parse(raw) as Partial<DailyExtra>
    if (parsed.day !== day) return { day, newExtra: 0, reviewsExtra: 0 }
    return {
      day,
      newExtra: Math.max(0, Math.round(Number(parsed.newExtra) || 0)),
      reviewsExtra: Math.max(0, Math.round(Number(parsed.reviewsExtra) || 0)),
    }
  } catch {
    return { day, newExtra: 0, reviewsExtra: 0 }
  }
}

/** Adds to today's allowance ("study more", Anki's custom study). */
export function bumpDailyExtra(
  db: Db,
  userId: string,
  add: { newExtra?: number; reviewsExtra?: number },
  ts: number = Date.now(),
): DailyExtra {
  const current = readDailyExtra(db, userId, ts)
  const next: DailyExtra = {
    day: current.day,
    newExtra: current.newExtra + Math.max(0, Math.round(add.newExtra ?? 0)),
    reviewsExtra: current.reviewsExtra + Math.max(0, Math.round(add.reviewsExtra ?? 0)),
  }
  setUserSetting(db, userId, KEYS.extraToday, JSON.stringify(next))
  return next
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
