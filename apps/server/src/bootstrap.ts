import { join } from 'node:path'
import type { Deps } from './context'
import {
  AUDIO_BACKFILL_KEY,
  createAudioService,
  gatewayAsr,
  gatewayTts,
  type AudioService,
} from './audio/service'
import { openDb, type Db } from './db/client'
import { clearDeckBuilds, getSetting, listUsers } from './db/repo'
import { env } from './env'
import { EventBus } from './events'
import { OpenRouter } from './llm/openrouter'
import { backfillGearInstances } from './services/gearInstances'
import { SpeechSupervisor } from './speech/supervisor'

export interface Built {
  deps: Deps
  close: () => void
}

export function buildDeps(cfg: typeof env): Built {
  const { db, sqlite } = openDb(join(cfg.dataDir, 'tutor.db'))
  clearDeckBuilds(db)
  const pieces = backfillGearInstances(db)
  if (pieces) console.log(`[gear] backfilled ${pieces} gear instances from legacy bank stacks`)
  const or = new OpenRouter(cfg.openrouterKey)
  const supervisor = speechSupervisor(cfg)
  const audio = createAudioService({
    db,
    dataDir: cfg.dataDir,
    tts: gatewayTts(supervisor),
    asr: gatewayAsr(supervisor),
  })
  resumeBackfill(db, audio)
  return { deps: depsOf(cfg, { db, or, supervisor, audio }), close: () => sqlite.close() }
}

function speechSupervisor(cfg: typeof env): SpeechSupervisor {
  return new SpeechSupervisor({
    url: cfg.speechUrl,
    port: cfg.speechPort,
    pythonDir: cfg.pythonDir,
    modelsDir: cfg.modelsDir,
    idleTimeoutMs: cfg.speechIdleTimeoutMs,
    autostart: cfg.speechAutostart,
  })
}

function resumeBackfill(db: Db, audio: AudioService): void {
  if (getSetting(db, AUDIO_BACKFILL_KEY) !== '1') return
  let queued = 0
  for (const user of listUsers(db)) queued += audio.enqueueUser(user.id)
  console.log(`[audio] resuming the library backfill (${queued} cards queued)`)
}

interface Cores {
  db: Db
  or: OpenRouter
  supervisor: SpeechSupervisor
  audio: AudioService
}

function depsOf(cfg: typeof env, core: Cores): Deps {
  return {
    ...core,
    events: new EventBus(),
    defaults: cfg.defaultRoles,
    serverKey: cfg.openrouterKey,
    secret: cfg.secret,
    allowRegistration: cfg.allowRegistration,
    sessionTtlMs: cfg.sessionTtlDays * 24 * 60 * 60 * 1000,
  }
}
