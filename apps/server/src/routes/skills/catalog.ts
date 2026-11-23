import type { Context } from 'hono'
import { SKILLS, SKILL_BY_ID, type SkillId } from '../../game/skills'
import { SYNERGY } from '../../game/talents'
import { loadPlayerCtx } from '../../services'
import type { App, AppEnv } from '../../context'
import { bonusSummary, boardSkills, gearPayload, itemSources, type Board } from './board'
import { fail } from '../errors'

export function registerSkillCatalog(app: App) {
  app.get('/api/skills', (c) => boardHandler(c))
  app.get('/api/skills/:id', (c) => skillPage(c))
}

function boardHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const ctx = loadPlayerCtx(deps.db, deps.events, user.id)
  const board = boardSkills(deps, user.id, ctx)
  return c.json({
    skills: board.skills,
    rigs: board.rigs,
    ...gearPayload(deps, user.id, ctx),
    bonuses: bonusSummary(ctx.bonuses),
  })
}

function skillPage(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const id = c.req.param('id') as SkillId
  if (!SKILL_BY_ID.has(id)) return fail(c, 404, 'unknown profession')
  const ctx = loadPlayerCtx(deps.db, deps.events, user.id)
  const board = boardSkills(deps, user.id, ctx)
  return c.json({
    skill: board.skills.find((s) => s.id === id)!,
    fedBy: fedBy(id, board),
    rigs: board.rigs,
    sources: itemSources(),
    ...gearPayload(deps, user.id, ctx),
    bonuses: bonusSummary(ctx.bonuses),
  })
}

function fedBy(id: SkillId, board: Board) {
  return SKILLS.filter((s) => SYNERGY[s.id].target === id).map((s) => ({
    skillId: s.id,
    name: s.name,
    label: SYNERGY[s.id].name,
    taken: board.skills.find((v) => v.id === s.id)?.talent.synergy.taken ?? [],
  }))
}
