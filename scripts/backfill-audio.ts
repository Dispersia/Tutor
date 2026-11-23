/**
 * One-off backfill: record the voice clips for every card that is missing
 * them. Same work the server does when a card is created (and the same
 * `POST /api/audio/backfill` route) — this runs it from a shell against a
 * database, so the whole existing library can be recorded in one go.
 *
 * Recording is slow (one clip at a time, ~1s each, a few voices per text) and
 * saturates the speech model while it runs. It is resumable: cards whose clips
 * already exist are skipped, so it can be stopped and started again. The
 * content-addressed store means a word shared between decks is only recorded
 * once.
 *
 * Needs the speech gateway (marginally it can start it itself). Run it inside
 * the dev shell so `uv`, `python` and the model weights are on PATH:
 *
 *   TUTOR_DATA_DIR=~/.local/share/tutor \
 *   TUTOR_MODELS_DIR=~/.local/share/tutor/models \
 *     nix develop -c bun scripts/backfill-audio.ts [deck-id-or-name]
 *
 * With no argument it records every card of every user.
 */

import { join } from 'node:path'
import { createAudioService, gatewayAsr, gatewayTts } from '../apps/server/src/audio/service'
import { openDb } from '../apps/server/src/db/client'
import { listUsers } from '../apps/server/src/db/repo'
import { decks } from '../apps/server/src/db/schema'
import { env } from '../apps/server/src/env'
import { SpeechSupervisor } from '../apps/server/src/speech/supervisor'

const target = process.argv.slice(2).find((a) => !a.startsWith('--'))

const { db, sqlite } = openDb(join(env.dataDir, 'tutor.db'))
const supervisor = new SpeechSupervisor({
  url: env.speechUrl,
  port: env.speechPort,
  pythonDir: env.pythonDir,
  modelsDir: env.modelsDir,
  idleTimeoutMs: env.speechIdleTimeoutMs,
  autostart: true,
})

const audio = createAudioService({
  db,
  dataDir: env.dataDir,
  tts: gatewayTts(supervisor),
  asr: gatewayAsr(supervisor),
})

console.log('[audio] starting the speech gateway…')
await supervisor.ensure()
console.log('[audio] gateway ready')

if (target) {
  const needle = target.toLowerCase()
  const deck = db
    .select()
    .from(decks)
    .all()
    .find((d) => d.id === target || d.name.toLowerCase().includes(needle))
  if (!deck?.userId) {
    console.error(`no owned deck matching ${JSON.stringify(target)} in ${env.dataDir}`)
    process.exit(1)
  }
  audio.enqueueDeck(deck.userId, deck.id)
  console.log(`[audio] queued "${deck.name}"`)
} else {
  let queued = 0
  for (const user of listUsers(db)) queued += audio.enqueueUser(user.id)
  console.log(`[audio] queued ${queued} cards across every user`)
}

let last = 0
for (;;) {
  const s = audio.status()
  if (s.recorded !== last) {
    last = s.recorded
    console.log(`[audio] recorded ${s.recorded} cards (${s.pending} queued)`)
  }
  if (s.pending === 0 && !s.running) break
  await Bun.sleep(1000)
}

const done = audio.status()
console.log(`[audio] done: ${done.recorded} cards recorded, ${done.failed} failed`)
await supervisor.stop()
sqlite.close()
