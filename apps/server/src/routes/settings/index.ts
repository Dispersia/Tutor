/**
 * The member's own settings (docs/DESIGN.md §12.5, §10.1): read the whole view,
 * then patch roles, voice, study prefs and the scalar tuning knobs.
 */

import type { Context } from 'hono'
import {
  getRoles,
  getUserSetting,
  listDecks,
  rememberedDeckInstruction,
  setDailyGoal,
  setUserSetting,
} from '../../db/repo'
import { INTRODUCE_ID, registry } from '../../exercises'
import { readStudyPrefs, writeStudyPrefs, type StudyPrefs } from '../../services/study'
import { ROLES, type Role } from '../../env'
import { hasUserKey, saveUserKey } from '../../llm/userkey'
import type { App, AppEnv, Deps } from '../../context'
import { bool, jsonBody, num, obj, oneOf, str, strArray, strRecord } from '../body'
import { readVoicePrefs } from './voice'

/** The voice modes the setting accepts. */
const VOICE_MODES = ['preset', 'design'] as const

export function registerSettings(app: App) {
  app.get('/api/settings', (c) => c.json(settingsView(c.get('deps'), c.get('user')!.id)))
  app.put('/api/settings', (c) => updateSettings(c))
  app.put('/api/settings/openrouter-key', (c) => saveKey(c))
}

function settingsView(deps: Deps, userId: string) {
  return {
    roles: getRoles(deps.db, userId, deps.defaults),
    roleDefaults: deps.defaults,
    allowedRoles: ROLES,
    voice: readVoicePrefs(deps.db, userId),
    study: readStudyPrefs(deps.db, userId),
    openrouter: { key: hasUserKey(deps, userId) },
    deckInstruction: rememberedDeckInstruction(deps.db, userId) ?? '',
    foodThreshold: Number(getUserSetting(deps.db, userId, 'foodThreshold') ?? 50),
    desiredRetention: Number(getUserSetting(deps.db, userId, 'desiredRetention') ?? 90),
  }
}

async function updateSettings(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const userId = c.get('user')!.id
  const body = await jsonBody(c)
  const roleErr = applyRoles(deps, userId, obj(body, 'roles'))
  if (roleErr) return c.json({ error: roleErr }, 400)
  applyVoice(deps, userId, obj(body, 'voice'))
  const studyErr = applyStudy(deps, userId, obj(body, 'study'))
  if (studyErr) return c.json({ error: studyErr }, 400)
  applyScalars(deps, userId, body)
  return c.json(settingsReply(deps, userId))
}

function settingsReply(deps: Deps, userId: string) {
  return {
    roles: getRoles(deps.db, userId, deps.defaults),
    voice: readVoicePrefs(deps.db, userId),
    study: readStudyPrefs(deps.db, userId),
  }
}

function applyRoles(
  deps: Deps,
  userId: string,
  roles?: Record<string, unknown>,
): string | undefined {
  if (!roles) return undefined
  const current = getRoles(deps.db, userId, deps.defaults)
  for (const [role, model] of Object.entries(roles)) {
    if (!ROLES.includes(role as Role)) return `unknown role: ${role}`
    if (typeof model !== 'string' || !model.trim()) return `invalid model for ${role}`
    current[role as Role] = model
  }
  setUserSetting(deps.db, userId, 'roles', JSON.stringify(current))
  return undefined
}

function applyVoice(deps: Deps, userId: string, voice?: Record<string, unknown>): void {
  if (!voice) return
  const mode = oneOf(voice, 'mode', VOICE_MODES)
  if (mode) setUserSetting(deps.db, userId, 'voiceMode', mode)
  const voices = strRecord(voice, 'voices')
  if (voices) setUserSetting(deps.db, userId, 'voices', JSON.stringify(voices))
}

function applyStudy(
  deps: Deps,
  userId: string,
  study?: Record<string, unknown>,
): string | undefined {
  if (!study) return undefined
  const activeDeckId = str(study, 'activeDeckId')
  if (activeDeckId !== undefined && !deckExists(deps, userId, activeDeckId)) {
    return 'unknown deck'
  }
  writeStudyPrefs(deps.db, userId, studyPatch(study))
  return undefined
}

/** Whether an active-deck id is one of this member's own decks ('' clears it). */
function deckExists(deps: Deps, userId: string, wanted: unknown): boolean {
  if (typeof wanted !== 'string' || !wanted) return true
  return listDecks(deps.db, userId).some((d) => d.id === wanted)
}

function studyPatch(study: Record<string, unknown>): Partial<StudyPrefs> {
  const patch: Partial<StudyPrefs> = {}
  const showZhuyin = bool(study, 'showZhuyin')
  if (showZhuyin !== undefined) patch.showZhuyin = showZhuyin
  const showFurigana = bool(study, 'showFurigana')
  if (showFurigana !== undefined) patch.showFurigana = showFurigana
  const newPerDay = num(study, 'newPerDay')
  if (newPerDay !== undefined) patch.newPerDay = newPerDay
  const maxReviews = num(study, 'maxReviewsPerDay')
  if (maxReviews !== undefined) patch.maxReviewsPerDay = maxReviews
  const autoReinforce = bool(study, 'autoReinforce')
  if (autoReinforce !== undefined) patch.autoReinforce = autoReinforce
  const disabled = strArray(study, 'disabledExercises')
  if (disabled) patch.disabledExercises = knownExercises(disabled)
  const steps = study.learningSteps
  if (Array.isArray(steps)) patch.learningSteps = positiveSteps(steps)
  const activeDeckId = str(study, 'activeDeckId')
  if (activeDeckId !== undefined) patch.activeDeckId = activeDeckId || null
  return patch
}

/** Only known exercise ids; the first-exposure "teach" step is never a drill. */
function knownExercises(ids: string[]): string[] {
  const known = new Set(registry.list().map((d) => d.id))
  return ids.filter(
    (id): id is string => typeof id === 'string' && id !== INTRODUCE_ID && known.has(id),
  )
}

function positiveSteps(steps: number[]): number[] {
  return steps.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
}

function applyScalars(deps: Deps, userId: string, body: Record<string, unknown>): void {
  const dailyGoal = num(body, 'dailyGoal')
  if (dailyGoal !== undefined) setDailyGoal(deps.db, userId, dailyGoal)
  const foodThreshold = num(body, 'foodThreshold')
  if (foodThreshold !== undefined) {
    setUserSetting(deps.db, userId, 'foodThreshold', String(clamp(foodThreshold, 10, 90)))
  }
  const desiredRetention = num(body, 'desiredRetention')
  if (desiredRetention !== undefined) {
    setUserSetting(deps.db, userId, 'desiredRetention', String(clamp(desiredRetention, 70, 97)))
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

/** Each user brings their own OpenRouter key (or uses the server's). */
async function saveKey(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const key = str(await jsonBody(c), 'key')
  await saveUserKey(deps, user.id, key ?? '')
  return c.json({ ok: true, openrouter: { key: hasUserKey(deps, user.id) } })
}
