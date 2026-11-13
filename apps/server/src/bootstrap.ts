import { join } from 'node:path'
import type { Deps } from './context'
import { openDb } from './db/client'
import { env } from './env'
import { OpenRouter } from './llm/openrouter'
import { SpeechSupervisor } from './speech/supervisor'

export interface Built {
  deps: Deps
  close: () => void
}

/** Wires the concrete deps from config. Reused by tests with a temp db. */
export function buildDeps(cfg: typeof env): Built {
  const { db, sqlite } = openDb(join(cfg.dataDir, 'tutor.db'))
  const or = new OpenRouter(cfg.openrouterKey)
  const supervisor = new SpeechSupervisor({
    url: cfg.speechUrl,
    port: cfg.speechPort,
    pythonDir: cfg.pythonDir,
    modelsDir: cfg.modelsDir,
    idleTimeoutMs: cfg.speechIdleTimeoutMs,
    autostart: cfg.speechAutostart,
  })
  return { deps: { db, or, supervisor, defaults: cfg.defaultRoles }, close: () => sqlite.close() }
}
