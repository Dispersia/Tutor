import { toDeckId, type UserId, type DeckId } from '../ids'
import type { Db } from '../db/client'
import { allUserSettings, getUserSetting, setUserSetting } from '../db/repo'
import { userDay } from './clock'

export interface StudyPrefs {
  showZhuyin: boolean
  showFurigana: boolean
  disabledExercises: string[]
  newPerDay: number
  maxReviewsPerDay: number
  learningSteps: number[]
  autoReinforce: boolean
  activeDeckId: DeckId | null
}

export const DEFAULT_STUDY_PREFS: StudyPrefs = {
  showZhuyin: true,
  showFurigana: true,
  disabledExercises: [],
  newPerDay: 20,
  maxReviewsPerDay: 200,
  learningSteps: [1, 10, 60, 240],
  autoReinforce: true,
  activeDeckId: null,
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
  activeDeck: 'study.activeDeck',
} as const

const MAX_STEP_MINUTES = 24 * 60

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback
  return raw !== '0' && raw !== 'false'
}

function nonEmpty(raw: string | undefined): DeckId | null {
  const value = raw?.trim()
  return value ? toDeckId(value) : null
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
    return steps.map((n) => Math.round(n))
  } catch {
    return [...fallback]
  }
}

export function readStudyPrefs(db: Db, userId: UserId): StudyPrefs {
  const all = allUserSettings(db, userId)
  const get = (key: string): string | undefined => all[key]
  const d = DEFAULT_STUDY_PREFS
  return {
    showZhuyin: bool(get(KEYS.showZhuyin), d.showZhuyin),
    showFurigana: bool(get(KEYS.showFurigana), d.showFurigana),
    disabledExercises: readDisabled(get(KEYS.disabledExercises)),
    newPerDay: int(get(KEYS.newPerDay), d.newPerDay, 0, 10_000),
    maxReviewsPerDay: int(get(KEYS.maxReviewsPerDay), d.maxReviewsPerDay, 0, 100_000),
    learningSteps: parseSteps(get(KEYS.learningSteps), d.learningSteps),
    autoReinforce: bool(get(KEYS.autoReinforce), d.autoReinforce),
    activeDeckId: nonEmpty(get(KEYS.activeDeck)),
  }
}

function readDisabled(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function writeStudyPrefs(db: Db, userId: UserId, patch: Partial<StudyPrefs>): StudyPrefs {
  const put = (key: string, value: string) => setUserSetting(db, userId, key, value)
  if (patch.showZhuyin !== undefined) put(KEYS.showZhuyin, patch.showZhuyin ? '1' : '0')
  if (patch.showFurigana !== undefined) put(KEYS.showFurigana, patch.showFurigana ? '1' : '0')
  if (patch.disabledExercises !== undefined) {
    put(KEYS.disabledExercises, JSON.stringify(patch.disabledExercises))
  }
  if (patch.newPerDay !== undefined) {
    put(KEYS.newPerDay, String(Math.max(0, Math.round(patch.newPerDay))))
  }
  if (patch.maxReviewsPerDay !== undefined) {
    put(KEYS.maxReviewsPerDay, String(Math.max(0, Math.round(patch.maxReviewsPerDay))))
  }
  if (patch.learningSteps !== undefined) {
    put(KEYS.learningSteps, JSON.stringify(patch.learningSteps))
  }
  if (patch.autoReinforce !== undefined) put(KEYS.autoReinforce, patch.autoReinforce ? '1' : '0')
  if (patch.activeDeckId !== undefined) put(KEYS.activeDeck, patch.activeDeckId ?? '')
  return readStudyPrefs(db, userId)
}

export interface DailyExtra {
  day: string
  newExtra: number
  reviewsExtra: number
}

export function readDailyExtra(db: Db, userId: UserId, ts: number = Date.now()): DailyExtra {
  const day = userDay(db, userId, ts)
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

export function bumpDailyExtra(
  db: Db,
  userId: UserId,
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

export function showsReadings(prefs: StudyPrefs, targetLang: string): boolean {
  if (targetLang === 'zh' || targetLang === 'yue') return prefs.showZhuyin
  if (targetLang === 'ja') return prefs.showFurigana
  return true
}
