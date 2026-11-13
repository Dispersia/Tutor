import type { Hono } from 'hono'
import type { Db } from './db/client'
import type { PublicUser } from './db/repo'
import type { Role } from './env'
import type { OpenRouter } from './llm/openrouter'
import type { SpeechSupervisor } from './speech/supervisor'

export interface Deps {
  db: Db
  /** Shared client (catalogue + fallback when a user has no key). */
  or: OpenRouter
  supervisor: SpeechSupervisor
  defaults: Record<Role, string>
  /** Server-level OpenRouter key, used when a user hasn't set their own. */
  serverKey?: string
  /** Encrypts per-user secrets at rest. */
  secret?: string
  allowRegistration: boolean
  sessionTtlMs: number
}

export type AppEnv = { Variables: { deps: Deps; user: PublicUser | null } }
export type App = Hono<AppEnv>
