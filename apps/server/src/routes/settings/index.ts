import { toDeckId, type UserId } from '../../ids'
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
import { isTimeZone, setUserTimeZone } from '../../services/clock'
import { readStudyPrefs, writeStudyPrefs, type StudyPrefs } from '../../services/study'
import { ROLES, type Role } from '../../env'
import { hasUserKey, saveUserKey } from '../../llm/userkey'
import type { App, AppEnv, Deps } from '../../context'
import { idField, bool, jsonBody, num, obj, str, strArray } from '../body'
import { fail } from '../errors'

export function registerSettings(app: App) {
  app.get('/api/settings', (c) => c.json(settingsView(c.get('deps'), c.get('user')!.id)))
  app.put('/api/settings', (c) => updateSettings(c))
  app.put('/api/settings/openrouter-key', (c) => saveKey(c))
}

function settingsView(deps: Deps, userId: UserId) {
  return {
    roles: getRoles(deps.db, userId, deps.defaults),
    roleDefaults: deps.defaults,
    allowedRoles: ROLES,
    study: readStudyPrefs(deps.db, userId),
    openrouter: { key: hasUserKey(deps, userId) },
    deckInstruction: rememberedDeckInstruction(deps.db, userId) ?? '',
    foodThreshold: Number(getUserSetting(deps.db, userId, 'foodThreshold') ?? 50),
    desiredRetention: Number(getUserSetting(deps.db, userId, 'desiredRetention') ?? 90),
    haptics: Number(getUserSetting(deps.db, userId, 'haptics') ?? 0),
  }
}

async function updateSettings(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const userId = c.get('user')!.id
  const body = await jsonBody(c)
  const roles = obj(body, 'roles')
  const study = obj(body, 'study')
  const error = rolesError(roles) ?? studyError(deps, userId, study) ?? timeZoneError(body)
  if (error) return fail(c, 400, error)
  if (roles) applyRoles(deps, userId, roles)
  if (study) writeStudyPrefs(deps.db, userId, studyPatch(study))
  applyScalars(deps, userId, body)
  return c.json(settingsReply(deps, userId))
}

function timeZoneError(body: Record<string, unknown>): string | undefined {
  const zone = str(body, 'timezone')
  if (zone === undefined || isTimeZone(zone)) return undefined
  return 'unknown time zone'
}

function settingsReply(deps: Deps, userId: UserId) {
  return {
    roles: getRoles(deps.db, userId, deps.defaults),
    study: readStudyPrefs(deps.db, userId),
  }
}

function rolesError(roles?: Record<string, unknown>): string | undefined {
  for (const [role, model] of Object.entries(roles ?? {})) {
    if (!ROLES.includes(role as Role)) return `unknown role: ${role}`
    if (typeof model !== 'string' || !model.trim()) return `invalid model for ${role}`
  }
  return undefined
}

function applyRoles(deps: Deps, userId: UserId, roles: Record<string, unknown>): void {
  const current = getRoles(deps.db, userId, deps.defaults)
  for (const [role, model] of Object.entries(roles)) current[role as Role] = model as string
  setUserSetting(deps.db, userId, 'roles', JSON.stringify(current))
}

function studyError(
  deps: Deps,
  userId: UserId,
  study?: Record<string, unknown>,
): string | undefined {
  const activeDeckId = study ? str(study, 'activeDeckId') : undefined
  if (activeDeckId !== undefined && !deckExists(deps, userId, activeDeckId)) return 'unknown deck'
  return undefined
}

function deckExists(deps: Deps, userId: UserId, wanted: unknown): boolean {
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
  const activeDeckId = idField(study, 'activeDeckId', toDeckId)
  if (activeDeckId !== undefined) patch.activeDeckId = activeDeckId || null
  return patch
}

function knownExercises(ids: string[]): string[] {
  const known = new Set(registry.list().map((d) => d.id))
  return ids.filter(
    (id): id is string => typeof id === 'string' && id !== INTRODUCE_ID && known.has(id),
  )
}

function positiveSteps(steps: number[]): number[] {
  return steps.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
}

function applyScalars(deps: Deps, userId: UserId, body: Record<string, unknown>): void {
  const zone = str(body, 'timezone')
  if (zone !== undefined) setUserTimeZone(deps.db, userId, zone)
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
  const haptics = num(body, 'haptics')
  if (haptics !== undefined) {
    setUserSetting(deps.db, userId, 'haptics', String(clamp(haptics, 0, 5)))
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

async function saveKey(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const key = str(await jsonBody(c), 'key')
  await saveUserKey(deps, user.id, key ?? '')
  return c.json({ ok: true, openrouter: { key: hasUserKey(deps, user.id) } })
}
