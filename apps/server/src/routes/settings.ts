import { allUserSettings, getRoles, setUserSetting } from '../db/repo'
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
      openrouter: { key: hasUserKey(deps, user.id) },
      raw: allUserSettings(deps.db, user.id),
    })
  })

  app.put('/api/settings', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      roles?: Partial<Record<Role, string>>
      voice?: Partial<VoicePrefs>
      prefs?: Record<string, string>
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

    if (body.prefs && typeof body.prefs === 'object') {
      for (const [k, v] of Object.entries(body.prefs)) {
        setUserSetting(deps.db, user.id, k, String(v))
      }
    }

    return c.json({
      roles: getRoles(deps.db, user.id, deps.defaults),
      voice: readVoicePrefs(deps.db, user.id),
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
