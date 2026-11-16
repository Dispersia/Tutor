/**
 * One-off backfill: annotate a deck's existing cards with pitch-accent metadata.
 * The bundled Japanese dictionary answers first (offline); the generator fills
 * whatever it does not know. Same work as `POST /api/decks/:id/pitch`, run from a
 * shell against a database (e.g. the packaged app's).
 *
 * `--force` re-annotates every card that has a reading from the dictionary alone,
 * replacing wrong contours (the generator's guesses) and needing no API key.
 *
 * Usage:
 *   TUTOR_DATA_DIR=~/.local/share/tutor bun scripts/backfill-pitch.ts <deck-id-or-name> [--force]
 */

import { join } from 'node:path'
import type { Deps } from '../apps/server/src/context'
import { openDb } from '../apps/server/src/db/client'
import { getRoles } from '../apps/server/src/db/repo'
import { decks } from '../apps/server/src/db/schema'
import {
  backfillDeckPitch,
  composeFetchers,
  dictionaryFetcher,
  llmPitchFetcher,
  type PitchFetcher,
} from '../apps/server/src/deck/pitch'
import { env, roleReasoning } from '../apps/server/src/env'
import { OpenRouter } from '../apps/server/src/llm/openrouter'
import { resolveUserKey } from '../apps/server/src/llm/userkey'

const force = process.argv.includes('--force')
const target = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'))
if (!target) {
  console.error('usage: bun scripts/backfill-pitch.ts <deck-id-or-name> [--force]')
  process.exit(1)
}

const { db, sqlite } = openDb(join(env.dataDir, 'tutor.db'))
const needle = target.toLowerCase()
const row = db
  .select()
  .from(decks)
  .all()
  .find((d) => d.id === target || d.name.toLowerCase().includes(needle))
if (!row) {
  console.error(`no deck matching ${JSON.stringify(target)} in ${env.dataDir}`)
  process.exit(1)
}
if (!row.userId) {
  console.error(`deck ${row.id} has no owner`)
  process.exit(1)
}

const dictionary = dictionaryFetcher(row.targetLang)
let fetcher: PitchFetcher = dictionary
if (!force) {
  const deps = { db, secret: env.secret, serverKey: env.openrouterKey } as unknown as Deps
  const key = await resolveUserKey(deps, row.userId)
  if (key) {
    const model = getRoles(db, row.userId, env.defaultRoles).generator
    fetcher = composeFetchers(
      dictionary,
      llmPitchFetcher(new OpenRouter(key), model, roleReasoning.generator, row.targetLang),
    )
  } else if (row.targetLang !== 'ja') {
    console.error('no OpenRouter key — set OPENROUTER_API_KEY or the user key (or use --force)')
    process.exit(1)
  }
}

console.log(`backfilling "${row.name}" (${row.targetLang})${force ? ' from the dictionary' : ''}…`)
const result = await backfillDeckPitch(db, row.userId, row.id, fetcher, { force })
console.log(`done: annotated ${result.updated} of ${result.total} cards`)
sqlite.close()
