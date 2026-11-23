/**
 * The member's own settings (docs/DESIGN.md §12.5, §10.1): read the whole view,
 * then patch roles, voice, study prefs and the scalar tuning knobs.
 */

import type { Context } from 'hono'
import {
  allUserSettings,
  getRoles,
  getUserSetting,
  listDecks,
  rememberedDeckInstruction,
  setDailyGoal,
  setUserSetting,
} from '../../db/repo'
import { INTRODUCE_ID, registry } from '../../exercises'
import { readStudyPrefs, writeStudyPrefs, type StudyPrefs } from '../../game/study'
import { ROLES, type Role } from '../../env'
import { hasUserKey, saveUserKey } from '../../llm/userkey'
import type { App, AppEnv, Deps } from '../../context'
import { readVoicePrefs, type VoicePrefs } from './voice'

/** The request body of `PUT /api/settings`, every section optional. */
interface SettingsBody {
  roles?: Partial<Record<Role, string>>
  voice?: Partial<VoicePrefs>
  study?: Partial<StudyPrefs>
  prefs?: Record<string, string>
  dailyGoal?: number
  foodThreshold?: number
  desiredRetention?: number
}

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
    raw: allUserSettings(deps.db, userId),
  }
}

async function updateSettings(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const userId = c.get('user')!.id
  const body = (await c.req.json().catch(() => ({}))) as SettingsBody
  const roleErr = applyRoles(deps, userId, body.roles)
  if (roleErr) return c.json({ error: roleErr }, 400)
  applyVoice(deps, userId, body.voice)
  const studyErr = applyStudy(deps, userId, body.study)
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
  roles?: Partial<Record<Role, string>>,
): string | undefined {
  if (!roles || typeof roles !== 'object') return undefined
  const current = getRoles(deps.db, userId, deps.defaults)
  for (const [role, model] of Object.entries(roles)) {
    if (!ROLES.includes(role as Role)) return `unknown role: ${role}`
    if (typeof model !== 'string' || !model.trim()) return `invalid model for ${role}`
    current[role as Role] = model
  }
  setUserSetting(deps.db, userId, 'roles', JSON.stringify(current))
  return undefined
}

function applyVoice(deps: Deps, userId: string, voice?: Partial<VoicePrefs>): void {
  if (!voice) return
  if (voice.mode === 'preset' || voice.mode === 'design') {
    setUserSetting(deps.db, userId, 'voiceMode', voice.mode)
  }
  if (voice.voices && typeof voice.voices === 'object') {
    setUserSetting(deps.db, userId, 'voices', JSON.stringify(voice.voices))
  }
}

function applyStudy(deps: Deps, userId: string, study?: Partial<StudyPrefs>): string | undefined {
  if (!study || typeof study !== 'object') return undefined
  if (study.activeDeckId !== undefined && !deckExists(deps, userId, study.activeDeckId)) {
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

function studyPatch(study: Partial<StudyPrefs>): Partial<StudyPrefs> {
  const patch: Partial<StudyPrefs> = {}
  if (typeof study.showZhuyin === 'boolean') patch.showZhuyin = study.showZhuyin
  if (typeof study.showFurigana === 'boolean') patch.showFurigana = study.showFurigana
  if (typeof study.newPerDay === 'number') patch.newPerDay = study.newPerDay
  if (typeof study.maxReviewsPerDay === 'number') patch.maxReviewsPerDay = study.maxReviewsPerDay
  if (typeof study.autoReinforce === 'boolean') patch.autoReinforce = study.autoReinforce
  if (Array.isArray(study.disabledExercises))
    patch.disabledExercises = knownExercises(study.disabledExercises)
  if (Array.isArray(study.learningSteps)) patch.learningSteps = positiveSteps(study.learningSteps)
  if (study.activeDeckId !== undefined) patch.activeDeckId = study.activeDeckId || null
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

function applyScalars(deps: Deps, userId: string, body: SettingsBody): void {
  if (body.prefs && typeof body.prefs === 'object') {
    for (const [k, v] of Object.entries(body.prefs)) setUserSetting(deps.db, userId, k, String(v))
  }
  if (typeof body.dailyGoal === 'number') setDailyGoal(deps.db, userId, body.dailyGoal)
  if (typeof body.foodThreshold === 'number') {
    setUserSetting(deps.db, userId, 'foodThreshold', String(clamp(body.foodThreshold, 10, 90)))
  }
  if (typeof body.desiredRetention === 'number') {
    setUserSetting(
      deps.db,
      userId,
      'desiredRetention',
      String(clamp(body.desiredRetention, 70, 97)),
    )
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

/** Each user brings their own OpenRouter key (or uses the server's). */
async function saveKey(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const { key } = (await c.req.json().catch(() => ({}))) as { key?: string }
  await saveUserKey(deps, user.id, key ?? '')
  return c.json({ ok: true, openrouter: { key: hasUserKey(deps, user.id) } })
}
