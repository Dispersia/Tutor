/** The idle-rig controls (docs/DESIGN.md §13.5.1, §13.5.3.1). */

import type { Context } from 'hono'
import { loadPlayerCtx, setRigChoice, stopRig } from '../../services'
import type { App, AppEnv } from '../../context'
import { jsonBody, str } from '../body'
import { boardSkills, gearPayload } from './board'

export function registerSkillRigs(app: App) {
  app.post('/api/skills/choice', (c) => chooseRecipe(c))
  app.post('/api/skills/rigs/stop', (c) => stopRigHandler(c))
}

/**
 * Pick which recipe a choose-input action runs (prospect any ore you hold, cut any
 * rough gem of a tier). One action, one level — the choice is a parameter.
 */
async function chooseRecipe(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = await jsonBody(c)
  const actionId = str(body, 'actionId')
  const choiceId = str(body, 'choiceId')
  if (!actionId || !choiceId) return c.json({ error: 'actionId and choiceId required' }, 400)
  if (!setRigChoice(deps.db, deps.events, user.id, { actionId, choiceId })) {
    return c.json({ error: 'unknown choice' }, 400)
  }
  const ctx = loadPlayerCtx(deps.db, deps.events, user.id)
  const board = boardSkills(deps, user.id, ctx)
  return c.json({
    ok: true,
    skills: board.skills,
    rigs: board.rigs,
    ...gearPayload(deps, user.id, ctx),
  })
}

/** Stop a running rig on purpose: its run is paid up to now, then it falls still. */
async function stopRigHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const actionId = str(await jsonBody(c), 'actionId')
  if (!actionId) return c.json({ error: 'actionId required' }, 400)
  const stopped = stopRig(deps.db, deps.events, user.id, actionId)
  const ctx = loadPlayerCtx(deps.db, deps.events, user.id)
  const board = boardSkills(deps, user.id, ctx)
  return c.json({
    ok: stopped,
    skills: board.skills,
    rigs: board.rigs,
    ...gearPayload(deps, user.id, ctx),
  })
}
