import type { Context } from 'hono'
import { chooseTalent, talentView } from '../../services'
import type { App, AppEnv } from '../../context'
import { jsonBody, str } from '../body'
import { fail } from '../errors'

export function registerSkillTalents(app: App) {
  app.post('/api/skills/talents', (c) => chooseTalentHandler(c))
}

async function chooseTalentHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const talentId = str(await jsonBody(c), 'talentId')
  if (!talentId) return fail(c, 400, 'talentId required')
  const res = chooseTalent(deps.db, deps.events, user.id, talentId)
  if (!res.ok) return fail(c, 400, res.error ?? 'talent not chosen')
  return c.json({ ok: true, talent: res.talent, talents: talentView(deps.db, user.id) })
}
