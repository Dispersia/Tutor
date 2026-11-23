/** The profession board and a single profession's page (docs/DESIGN.md §13.5). */

import type { Context } from 'hono'
import { SKILLS, SKILL_BY_ID, type SkillId } from '../../game/skills'
import { SYNERGY } from '../../game/talents'
import { aggregateBonuses } from '../../services'
import type { App, AppEnv } from '../../context'
import { bonusSummary, boardSkills, gearPayload, itemSources, type Board } from './board'

export function registerSkillCatalog(app: App) {
  app.get('/api/skills', (c) => boardHandler(c))
  app.get('/api/skills/:id', (c) => skillPage(c))
}

/** The board: skills (+derived level), their actions, talents and bank. */
function boardHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const board = boardSkills(deps, user.id)
  return c.json({
    skills: board.skills,
    rigs: board.rigs,
    ...gearPayload(deps, user.id),
    bonuses: bonusSummary(aggregateBonuses(deps.db, user.id)),
  })
}

/** One profession: its actions, the talent roadmap and the costs' sources. */
function skillPage(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const id = c.req.param('id') as SkillId
  if (!SKILL_BY_ID.has(id)) return c.json({ error: 'unknown profession' }, 404)
  const board = boardSkills(deps, user.id)
  return c.json({
    skill: board.skills.find((s) => s.id === id)!,
    fedBy: fedBy(id, board),
    rigs: board.rigs,
    sources: itemSources(),
    ...gearPayload(deps, user.id),
    bonuses: bonusSummary(aggregateBonuses(deps.db, user.id)),
  })
}

/**
 * The reverse edge of the talent web: professions whose synergy talent feeds this
 * one. A skill can be fed by more than one trade, so this is a list; `taken` tells
 * the page whether the player actually has that talent.
 */
function fedBy(id: SkillId, board: Board) {
  return SKILLS.filter((s) => SYNERGY[s.id].target === id).map((s) => ({
    skillId: s.id,
    name: s.name,
    label: SYNERGY[s.id].name,
    taken: board.skills.find((v) => v.id === s.id)?.talent.synergy.taken ?? [],
  }))
}
