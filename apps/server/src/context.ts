import type { Hono } from 'hono'
import type { Db } from './db/client'
import type { Role } from './env'
import type { OpenRouter } from './llm/openrouter'
import type { SpeechSupervisor } from './speech/supervisor'

export interface Deps {
  db: Db
  or: OpenRouter
  supervisor: SpeechSupervisor
  defaults: Record<Role, string>
}

export type AppEnv = { Variables: { deps: Deps } }
export type App = Hono<AppEnv>
