/**
 * One-off: regenerate a generated deck's example cards (sentence/grammar) with
 * the n+1-enforcing builder, while keeping every vocabulary card — and therefore
 * all SRS scheduling, review history and lesson progress — untouched.
 *
 *   bun scripts/rebuild-deck-examples.ts <deckId>
 *
 * It builds a throwaway deck from the deck's own stored word list, then copies
 * the (already n+1-validated) sentence/grammar cards onto the real deck, anchored
 * to the same vocabulary word each one was built from. The real deck's vocab
 * cards and their ids never change, so lesson ids stay stable.
 *
 * Set TUTOR_DATA_DIR to the live data dir (e.g. ~/.local/share/tutor).
 */
import { join } from 'node:path'
import { env, roleReasoning } from '../apps/server/src/env'
import { openDb } from '../apps/server/src/db/client'
import {
  addCard,
  completeLesson,
  deleteDeck,
  getRoles,
  getUserSetting,
  listCards,
  updateDeckSettings,
} from '../apps/server/src/db/repo'
import { decryptSecret } from '../apps/server/src/auth'
import { OpenRouter } from '../apps/server/src/llm/openrouter'
import { llmPlanner } from '../apps/server/src/deck/plan'
import { createDeckForBuild, fillDeck } from '../apps/server/src/deck/generate'
import type { CharacterVariant } from '../apps/server/src/deck/settings'
import { curriculumView } from '../apps/server/src/services'
import type { DeckId, UserId } from '../apps/server/src/ids'

const deckId = process.argv[2] as DeckId | undefined
if (!deckId) throw new Error('usage: bun scripts/rebuild-deck-examples.ts <deckId>')

const { db, sqlite } = openDb(join(env.dataDir, 'tutor.db'))

interface DeckRow {
  id: DeckId
  userId: UserId
  name: string
  sourceLang: string
  targetLang: string
  settingsJson: string
}
const deckRow = sqlite
  .query(
    'select id, user_id as userId, name, source_lang as sourceLang, target_lang as targetLang, settings_json as settingsJson from decks where id = ?',
  )
  .get(deckId) as DeckRow | undefined
if (!deckRow) throw new Error(`deck not found: ${deckId}`)

const userId = deckRow.userId
const settings = JSON.parse(deckRow.settingsJson || '{}') as Record<string, unknown>
const words = (settings.words as string[] | undefined) ?? []
if (words.length === 0) throw new Error('deck has no stored word list to rebuild from')
console.log(`deck "${deckRow.name}" (${deckId}) — ${words.length} words`)

// 1. Keep every lesson that is currently complete complete: the regenerated
//    examples are new cards with no SRS state, so without this the learnt
//    vocab would still count but the fresh examples would flip lessons back to
//    "incomplete" and send the learner to step 1.
const view = curriculumView(db, userId).find((d) => d.deckId === deckId)
let keptComplete = 0
for (const lesson of view?.lessons ?? []) {
  if (lesson.complete) {
    completeLesson(db, userId, lesson.id)
    keptComplete++
  }
}
console.log(`kept ${keptComplete} completed lessons complete`)

// 2. The real deck's vocab, in step order, so an example built on word W lands
//    in W's lesson.
const realCards = listCards(db, userId, deckId)
const stepByWord = new Map<string, number>()
for (const c of realCards) {
  if (c.payload?.template === 'vocab' && typeof c.payload.step === 'number') {
    stepByWord.set(c.back, c.payload.step)
  }
}
const oldExamples = realCards.filter(
  (c) => typeof c.payload?.template === 'string' && c.payload.template !== 'vocab',
)
console.log(`real deck: ${stepByWord.size} vocab cards, ${oldExamples.length} old examples`)

// 3. Generate a fresh set into a throwaway deck, reusing the production builder
//    (same chunking, retry-on-truncation and n+1 validation the server uses).
const key = await decryptSecret(
  getUserSetting(db, userId, 'openrouter_key') || undefined,
  env.secret,
)
if (!key) throw new Error('no OpenRouter key for the deck owner')
const model = getRoles(db, userId, { ...env.defaultRoles }).generator
console.log(`generator model: ${model}`)
if (process.env.REBUILD_DRY === '1') {
  console.log(
    `dry run ok — data dir ${env.dataDir}, key ${key.slice(0, 8)}…, ${words.length} words`,
  )
  sqlite.close()
  process.exit(0)
}
const planner = llmPlanner(new OpenRouter(key, undefined), model, roleReasoning.generator)

const instruction =
  'a Japanese deck from the Kaishi 1.5k word list. Include natural example sentences ' +
  'and short grammar points that use only words already introduced (strict n+1, one ' +
  'new word per step). Write readings in kana only.'

const created = await createDeckForBuild(db, userId, {
  instruction,
  targetLang: deckRow.targetLang,
  sourceLang: deckRow.sourceLang,
  words,
  count: words.length,
  name: `__rebuild_${Date.now()}`,
  variant: settings.variant as CharacterVariant | undefined,
  readingScript: settings.readingScript as string | undefined,
  showReadings: settings.showReadings as boolean | undefined,
  disabledExercises: settings.disabledExercises as string[] | undefined,
  pitchAccent: settings.pitchAccent as boolean | undefined,
  sourceLabel: 'Kaishi 1.5k',
  planner,
})
const ctx = {
  instruction,
  targetLang: deckRow.targetLang,
  sourceLang: deckRow.sourceLang,
  variant: settings.variant as CharacterVariant | undefined,
  readingScript: settings.readingScript as string | undefined,
  pitchAccent: settings.pitchAccent as boolean | undefined,
}
const started = Date.now()
try {
  await fillDeck(db, userId, created.deckId, {
    ctx,
    opts: { words, count: words.length, knownWords: [], startStep: 0 },
    planner,
  })
} catch (err) {
  deleteDeck(db, created.deckId)
  throw err
}
console.log(`generated in ${Math.round((Date.now() - started) / 1000)}s`)

// 4. Collect the new examples, anchored to the word whose lesson they belong to.
interface Pending {
  type: string
  front: string
  back: string
  readings: Record<string, string>
  tags: string[]
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  step: number
}
const tempCards = listCards(db, userId, created.deckId)
const pending: Pending[] = []
let anchor = ''
let skipped = 0
for (const c of tempCards) {
  if (c.payload?.template === 'vocab') {
    anchor = c.back
    continue
  }
  const step = stepByWord.get(anchor)
  if (typeof step !== 'number') {
    skipped++
    continue
  }
  pending.push({
    type: c.type,
    front: c.front,
    back: c.back,
    readings: c.readings,
    tags: c.tags,
    payload: { ...(c.payload ?? {}), step },
    metadata: (c.metadata ?? {}) as Record<string, unknown>,
    step,
  })
}
console.log(`new examples: ${pending.length} (${skipped} skipped: unknown anchor)`)
if (pending.length === 0) {
  deleteDeck(db, created.deckId)
  throw new Error('generation produced no examples — deck left untouched')
}

// 5. Swap the examples. Vocab cards are never touched.
for (const c of oldExamples) {
  sqlite.run('delete from srs where card_id = ?', [c.id])
  sqlite.run('delete from srs_reviews where card_id = ?', [c.id])
  sqlite.run('delete from reviews where card_id = ?', [c.id])
  sqlite.run('delete from attempts where card_id = ?', [c.id])
  sqlite.run('delete from cards where id = ?', [c.id])
}
for (const e of pending) {
  addCard(db, userId, {
    deckId,
    type: e.type as never,
    sourceLang: deckRow.sourceLang,
    targetLang: deckRow.targetLang,
    front: e.front,
    back: e.back,
    readings: e.readings,
    tags: e.tags,
    payload: e.payload,
    metadata: e.metadata as never,
    origin: 'llm',
  })
}
deleteDeck(db, created.deckId)
updateDeckSettings(db, deckId, { instruction })

console.log(`done: removed ${oldExamples.length} old examples, added ${pending.length}`)
sqlite.close()
