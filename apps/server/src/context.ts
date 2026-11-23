import type { Hono } from 'hono'
import type { Db } from './db/client'
import type { PublicUser } from './db/repo'
import type { Role } from './env'
import type { Planner } from './deck/plan'
import type { PitchFetcher } from './deck/pitch'
import type { EventBus } from './events'
import type { Fetcher } from './frequency/source'
import type { OpenRouter } from './llm/openrouter'
import type { AssessFn } from './pronunciation/assess'
import type { SpeechSupervisor } from './speech/supervisor'
import type { AudioService } from './audio/service'

export interface Deps {
  db: Db
  /** Shared client (catalogue + fallback when a user has no key). */
  or: OpenRouter
  supervisor: SpeechSupervisor
  /** Pre-recorded card audio; absent in most tests (routes degrade to 503). */
  audio?: AudioService
  /** Domain event bus for game systems (DESIGN §11.4). */
  events: EventBus
  defaults: Record<Role, string>
  /** Server-level OpenRouter key, used when a user hasn't set their own. */
  serverKey?: string
  /** Encrypts per-user secrets at rest. */
  secret?: string
  allowRegistration: boolean
  sessionTtlMs: number
  /** Test hook: overrides the real speech assessor. */
  assess?: AssessFn
  /** Test hook: overrides the frequency-list fetcher used by the deck builder. */
  fetcher?: Fetcher
  /** Test hook: overrides the LLM deck planner. */
  planner?: Planner
  /** Test hook: overrides the LLM pitch-accent annotator. */
  pitch?: PitchFetcher
}

export type AppEnv = { Variables: { deps: Deps; user: PublicUser | null } }
export type App = Hono<AppEnv>
