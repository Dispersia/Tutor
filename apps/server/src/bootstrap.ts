import { join } from 'node:path'
import type { Deps } from './context'
import { openDb } from './db/client'
import { clearDeckBuilds } from './db/repo'
import { env } from './env'
import { EventBus } from './events'
import { OpenRouter } from './llm/openrouter'
import { SpeechSupervisor } from './speech/supervisor'

export interface Built {
  deps: Deps
  close: () => void
}

/** Wires the concrete deps from config. Reused by tests with a temp db. */
export function buildDeps(cfg: typeof env): Built {
  const { db, sqlite } = openDb(join(cfg.dataDir, 'tutor.db'))
  // A background deck build cannot survive a restart: clear the flags it left
  // behind so a half-built domain never looks busy forever.
  clearDeckBuilds(db)
  const or = new OpenRouter(cfg.openrouterKey)
  const supervisor = new SpeechSupervisor({
    url: cfg.speechUrl,
    port: cfg.speechPort,
    pythonDir: cfg.pythonDir,
    modelsDir: cfg.modelsDir,
    idleTimeoutMs: cfg.speechIdleTimeoutMs,
    autostart: cfg.speechAutostart,
  })
  return {
    deps: {
      db,
      or,
      supervisor,
      events: new EventBus(),
      defaults: cfg.defaultRoles,
      serverKey: cfg.openrouterKey,
      secret: cfg.secret,
      allowRegistration: cfg.allowRegistration,
      sessionTtlMs: cfg.sessionTtlDays * 24 * 60 * 60 * 1000,
    },
    close: () => sqlite.close(),
  }
}
