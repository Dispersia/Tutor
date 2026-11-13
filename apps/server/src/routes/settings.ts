import { allSettings, getRoles, setSetting } from '../db/repo'
import { ROLES, type Role } from '../env'
import type { App } from '../context'

export function registerSettings(app: App) {
  app.get('/api/settings', (c) => {
    const deps = c.get('deps')
    return c.json({
      roles: getRoles(deps.db, deps.defaults),
      roleDefaults: deps.defaults,
      allowedRoles: ROLES,
      raw: allSettings(deps.db),
    })
  })

  // Update one or more roles and/or arbitrary prefs. Persisted in `settings`.
  app.put('/api/settings', async (c) => {
    const deps = c.get('deps')
    const body = (await c.req.json().catch(() => ({}))) as {
      roles?: Partial<Record<Role, string>>
      [k: string]: unknown
    }

    if (body.roles && typeof body.roles === 'object') {
      const current = getRoles(deps.db, deps.defaults)
      for (const [role, model] of Object.entries(body.roles)) {
        if (!ROLES.includes(role as Role)) return c.json({ error: `unknown role: ${role}` }, 400)
        if (typeof model !== 'string' || !model.trim()) {
          return c.json({ error: `invalid model for ${role}` }, 400)
        }
        current[role as Role] = model
      }
      setSetting(deps.db, 'roles', JSON.stringify(current))
    }

    for (const [k, v] of Object.entries(body)) {
      if (k === 'roles') continue
      setSetting(deps.db, k, typeof v === 'string' ? v : JSON.stringify(v))
    }

    return c.json({ roles: getRoles(deps.db, deps.defaults) })
  })
}
