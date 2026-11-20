import {
  allUserSettings,
  getRoles,
  getUserSetting,
  listDecks,
  rememberedDeckInstruction,
  setDailyGoal,
  setUserSetting,
} from '../db/repo'
import { INTRODUCE_ID, registry } from '../exercises'
import { readStudyPrefs, writeStudyPrefs, type StudyPrefs } from '../game/study'
import { ROLES, type Role } from '../env'
import { hasUserKey, saveUserKey } from '../llm/userkey'
import type { App } from '../context'

export interface VoicePrefs {
  mode: 'preset' | 'design'
  voices: Record<string, string>
}

const DEFAULT_VOICE: VoicePrefs = { mode: 'preset', voices: {} }

export function readVoicePrefs(
  db: Parameters<typeof allUserSettings>[0],
  userId: string,
): VoicePrefs {
  const s = allUserSettings(db, userId)
  let voices: Record<string, string> = {}
  try {
    voices = s.voices ? (JSON.parse(s.voices) as Record<string, string>) : {}
  } catch {
    voices = {}
  }
  return { mode: s.voiceMode === 'design' ? 'design' : 'preset', voices }
}

export function registerSettings(app: App) {
  app.get('/api/settings', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    return c.json({
      roles: getRoles(deps.db, user.id, deps.defaults),
      roleDefaults: deps.defaults,
      allowedRoles: ROLES,
      voice: readVoicePrefs(deps.db, user.id),
      study: readStudyPrefs(deps.db, user.id),
      openrouter: { key: hasUserKey(deps, user.id) },
      deckInstruction: rememberedDeckInstruction(deps.db, user.id) ?? '',
      foodThreshold: Number(getUserSetting(deps.db, user.id, 'foodThreshold') ?? 50),
      desiredRetention: Number(getUserSetting(deps.db, user.id, 'desiredRetention') ?? 90),
      raw: allUserSettings(deps.db, user.id),
    })
  })

  app.put('/api/settings', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      roles?: Partial<Record<Role, string>>
      voice?: Partial<VoicePrefs>
      study?: Partial<StudyPrefs>
      prefs?: Record<string, string>
      dailyGoal?: number
      foodThreshold?: number
      desiredRetention?: number
    }

    if (body.roles && typeof body.roles === 'object') {
      const current = getRoles(deps.db, user.id, deps.defaults)
      for (const [role, model] of Object.entries(body.roles)) {
        if (!ROLES.includes(role as Role)) return c.json({ error: `unknown role: ${role}` }, 400)
        if (typeof model !== 'string' || !model.trim()) {
          return c.json({ error: `invalid model for ${role}` }, 400)
        }
        current[role as Role] = model
      }
      setUserSetting(deps.db, user.id, 'roles', JSON.stringify(current))
    }

    if (body.voice) {
      if (body.voice.mode === 'preset' || body.voice.mode === 'design') {
        setUserSetting(deps.db, user.id, 'voiceMode', body.voice.mode)
      }
      if (body.voice.voices && typeof body.voice.voices === 'object') {
        setUserSetting(deps.db, user.id, 'voices', JSON.stringify(body.voice.voices))
      }
    }

    if (body.study && typeof body.study === 'object') {
      const patch: Partial<StudyPrefs> = {}
      if (typeof body.study.showZhuyin === 'boolean') patch.showZhuyin = body.study.showZhuyin
      if (typeof body.study.showFurigana === 'boolean') patch.showFurigana = body.study.showFurigana
      if (Array.isArray(body.study.disabledExercises)) {
        // Only known exercise ids; the first-exposure "teach" step is never a drill.
        const known = new Set(registry.list().map((d) => d.id))
        patch.disabledExercises = body.study.disabledExercises.filter(
          (id): id is string => typeof id === 'string' && id !== INTRODUCE_ID && known.has(id),
        )
      }
      if (typeof body.study.newPerDay === 'number') patch.newPerDay = body.study.newPerDay
      if (typeof body.study.maxReviewsPerDay === 'number')
        patch.maxReviewsPerDay = body.study.maxReviewsPerDay
      if (Array.isArray(body.study.learningSteps)) {
        patch.learningSteps = body.study.learningSteps.filter(
          (n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0,
        )
      }
      if (typeof body.study.autoReinforce === 'boolean')
        patch.autoReinforce = body.study.autoReinforce
      // The deck studied everywhere. Empty clears it (free practice across all
      // decks); a non-empty id must be one of this member's own decks.
      if (body.study.activeDeckId !== undefined) {
        const wanted = typeof body.study.activeDeckId === 'string' ? body.study.activeDeckId : ''
        if (!wanted) {
          patch.activeDeckId = null
        } else if (listDecks(deps.db, user.id).some((d) => d.id === wanted)) {
          patch.activeDeckId = wanted
        } else {
          return c.json({ error: 'unknown deck' }, 400)
        }
      }
      writeStudyPrefs(deps.db, user.id, patch)
    }

    if (body.prefs && typeof body.prefs === 'object') {
      for (const [k, v] of Object.entries(body.prefs)) {
        setUserSetting(deps.db, user.id, k, String(v))
      }
    }

    if (typeof body.dailyGoal === 'number') {
      setDailyGoal(deps.db, user.id, body.dailyGoal)
    }
    if (typeof body.foodThreshold === 'number') {
      const pct = Math.max(10, Math.min(90, Math.round(body.foodThreshold)))
      setUserSetting(deps.db, user.id, 'foodThreshold', String(pct))
    }
    if (typeof body.desiredRetention === 'number') {
      const pct = Math.max(70, Math.min(97, Math.round(body.desiredRetention)))
      setUserSetting(deps.db, user.id, 'desiredRetention', String(pct))
    }

    return c.json({
      roles: getRoles(deps.db, user.id, deps.defaults),
      voice: readVoicePrefs(deps.db, user.id),
      study: readStudyPrefs(deps.db, user.id),
    })
  })

  // Each user brings their own OpenRouter key (or uses the server's).
  app.put('/api/settings/openrouter-key', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { key } = (await c.req.json().catch(() => ({}))) as { key?: string }
    await saveUserKey(deps, user.id, key ?? '')
    return c.json({ ok: true, openrouter: { key: hasUserKey(deps, user.id) } })
  })
}
