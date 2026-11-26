import type { UserId } from '../ids'
import type { Deps } from '../context'
import { getRoles } from '../db/repo'
import { roleReasoning } from '../env'
import { OpenRouter } from '../llm/openrouter'
import { resolveUserKey } from '../llm/userkey'
import { llmPlanner, type Planner, llmChatPlanner, type ChatPlanner } from './plan'
import { llmReviewer, type Reviewer } from './review'

export async function plannerFor(deps: Deps, userId: UserId): Promise<Planner | undefined> {
  if (deps.planner) return deps.planner
  const key = await resolveUserKey(deps, userId)
  if (!key) return undefined
  const model = getRoles(deps.db, userId, deps.defaults).generator
  return llmPlanner(new OpenRouter(key, deps.or.baseUrl), model, roleReasoning.generator)
}

export async function chatPlannerFor(deps: Deps, userId: UserId): Promise<ChatPlanner | undefined> {
  if (deps.chatPlanner) return deps.chatPlanner
  const key = await resolveUserKey(deps, userId)
  if (!key) return undefined
  const model = getRoles(deps.db, userId, deps.defaults).generator
  return llmChatPlanner(new OpenRouter(key, deps.or.baseUrl), model, roleReasoning.generator)
}

export async function reviewerFor(deps: Deps, userId: UserId): Promise<Reviewer | undefined> {
  if (deps.reviewer) return deps.reviewer
  const key = await resolveUserKey(deps, userId)
  if (!key) return undefined
  const model = getRoles(deps.db, userId, deps.defaults).judge
  return llmReviewer(new OpenRouter(key, deps.or.baseUrl), model, roleReasoning.judge)
}
