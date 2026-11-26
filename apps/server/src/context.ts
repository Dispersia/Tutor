import type { Hono } from 'hono'
import type { Db } from './db/client'
import type { PublicUser } from './db/repo'
import type { Role } from './env'
import type { Planner, ChatPlanner } from './deck/plan'
import type { Reviewer } from './deck/review'
import type { PitchFetcher } from './deck/pitch'
import type { EventBus } from './events'
import type { Fetcher } from './frequency/source'
import type { OpenRouter } from './llm/openrouter'
import type { AssessFn } from './pronunciation/types'
import type { SpeechSupervisor } from './speech/supervisor'
import type { AudioService } from './audio/service'

export interface Deps {
  db: Db
  or: OpenRouter
  supervisor: SpeechSupervisor
  audio?: AudioService
  events: EventBus
  defaults: Record<Role, string>
  serverKey?: string
  secret?: string
  allowRegistration: boolean
  sessionTtlMs: number
  assess?: AssessFn
  fetcher?: Fetcher
  planner?: Planner
  chatPlanner?: ChatPlanner
  reviewer?: Reviewer
  pitch?: PitchFetcher
}

export type AppEnv = { Variables: { deps: Deps; user: PublicUser | null } }
export type App = Hono<AppEnv>
