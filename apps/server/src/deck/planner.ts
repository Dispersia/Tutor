import type { UserId } from '../ids'
import type { Deps } from '../context'
import { getRoles } from '../db/repo'
import { roleReasoning } from '../env'
import { OpenRouter } from '../llm/openrouter'
import { resolveUserKey } from '../llm/userkey'
import { llmPlanner, type Planner } from './plan'

export async function plannerFor(deps: Deps, userId: UserId): Promise<Planner | undefined> {
  if (deps.planner) return deps.planner
  const key = await resolveUserKey(deps, userId)
  if (!key) return undefined
  const model = getRoles(deps.db, userId, deps.defaults).generator
  return llmPlanner(new OpenRouter(key, deps.or.baseUrl), model, roleReasoning.generator)
}
