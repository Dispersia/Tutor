import { join } from 'node:path'
import type { Deps } from './context'
import { AUDIO_BACKFILL_KEY, createAudioService, gatewayTts } from './audio/service'
import { openDb } from './db/client'
import { clearDeckBuilds, getSetting, listUsers } from './db/repo'
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
  const audio = createAudioService({ db, dataDir: cfg.dataDir, tts: gatewayTts(supervisor) })
  // A full library recording runs for hours and lives in memory, so a restart
  // would abandon it. When the backfill flag is set, pick it back up on boot —
  // already-recorded clips are skipped, so it resumes where it stopped.
  if (getSetting(db, AUDIO_BACKFILL_KEY) === '1') {
    let queued = 0
    for (const user of listUsers(db)) queued += audio.enqueueUser(user.id)
    console.log(`[audio] resuming the library backfill (${queued} cards queued)`)
  }
  return {
    deps: {
      db,
      or,
      supervisor,
      audio,
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
