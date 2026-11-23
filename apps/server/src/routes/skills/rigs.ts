import type { Context } from 'hono'
import { loadPlayerCtx, setRigChoice, stopRig } from '../../services'
import type { App, AppEnv } from '../../context'
import { jsonBody, str } from '../body'
import { boardSkills, gearPayload } from './board'
import { fail } from '../errors'

export function registerSkillRigs(app: App) {
  app.post('/api/skills/choice', (c) => chooseRecipe(c))
  app.post('/api/skills/rigs/stop', (c) => stopRigHandler(c))
}

async function chooseRecipe(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = await jsonBody(c)
  const actionId = str(body, 'actionId')
  const choiceId = str(body, 'choiceId')
  if (!actionId || !choiceId) return fail(c, 400, 'actionId and choiceId required')
  if (!setRigChoice(deps.db, deps.events, user.id, { actionId, choiceId })) {
    return fail(c, 400, 'unknown choice')
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

async function stopRigHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const actionId = str(await jsonBody(c), 'actionId')
  if (!actionId) return fail(c, 400, 'actionId required')
  stopRig(deps.db, deps.events, user.id, actionId)
  const ctx = loadPlayerCtx(deps.db, deps.events, user.id)
  const board = boardSkills(deps, user.id, ctx)
  return c.json({
    ok: true,
    skills: board.skills,
    rigs: board.rigs,
    ...gearPayload(deps, user.id, ctx),
  })
}
