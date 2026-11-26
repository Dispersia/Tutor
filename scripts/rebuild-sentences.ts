import { join } from 'node:path'
import { homedir } from 'node:os'
import { env, roleReasoning } from '../apps/server/src/env'
import { openDb } from '../apps/server/src/db/client'
import {
  addCard,
  completeLesson,
  deleteDeck,
  getRoles,
  getUserSetting,
  listCards,
} from '../apps/server/src/db/repo'
import { decryptSecret } from '../apps/server/src/auth'
import { OpenRouter } from '../apps/server/src/llm/openrouter'
import { llmPlanner, type Planner } from '../apps/server/src/deck/plan'
import { createDeckForBuild, fillDeck } from '../apps/server/src/deck/generate'
import type { CharacterVariant } from '../apps/server/src/deck/settings'
import { curriculumView } from '../apps/server/src/services'
import type { DeckId, UserId } from '../apps/server/src/ids'

const args = process.argv.slice(2)
const only = args.find((a) => !a.startsWith('--')) as DeckId | undefined
const dry = args.includes('--dry')

const dataDir = process.env.TUTOR_DATA_DIR ?? join(homedir(), '.local/share/tutor')
const { db, sqlite } = openDb(join(dataDir, 'tutor.db'))

type Cards = ReturnType<typeof listCards>
type Settings = Record<string, unknown>
type CardType = Cards[number]['type']

interface DeckRow {
  id: DeckId
  userId: UserId
  name: string
  sourceLang: string
  targetLang: string
  settingsJson: string
}

interface Pending {
  type: CardType
  front: string
  back: string
  readings: Record<string, string>
  tags: string[]
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
}

function deckRows(): DeckRow[] {
  return sqlite
    .query(
      'select id, user_id as userId, name, source_lang as sourceLang, target_lang as targetLang, settings_json as settingsJson from decks',
    )
    .all() as DeckRow[]
}

function isVocab(c: Cards[number]): boolean {
  return c.payload?.template === 'vocab' && typeof c.payload?.step === 'number'
}

function wordsOf(settings: Settings, cards: Cards): string[] {
  const stored = settings.words as string[] | undefined
  if (stored?.length) return stored
  return cards
    .filter(isVocab)
    .sort((a, b) => Number(a.payload?.step) - Number(b.payload?.step))
    .map((c) => c.back)
}

function stepByWord(cards: Cards): Map<string, number> {
  const map = new Map<string, number>()
  for (const c of cards) {
    if (isVocab(c)) map.set(c.back, Number(c.payload?.step))
  }
  return map
}

function toPending(c: Cards[number], step: number): Pending {
  return {
    type: c.type,
    front: c.front,
    back: c.back,
    readings: c.readings,
    tags: c.tags,
    payload: { ...(c.payload ?? {}), step },
    metadata: (c.metadata ?? {}) as Record<string, unknown>,
  }
}

function pendingSentences(temp: Cards, steps: Map<string, number>): Pending[] {
  const out: Pending[] = []
  let anchor = ''
  for (const c of temp) {
    if (c.payload?.template === 'vocab') {
      anchor = c.back
      continue
    }
    if (c.payload?.template !== 'sentence') continue
    const step = steps.get(anchor)
    if (typeof step === 'number') out.push(toPending(c, step))
  }
  return out
}

async function plannerFor(userId: UserId, name: string): Promise<Planner> {
  const saved = getUserSetting(db, userId, 'openrouter_key') || undefined
  const key = (await decryptSecret(saved, env.secret)) ?? env.openrouterKey
  if (!key) throw new Error(`no OpenRouter key for ${name}`)
  const model = getRoles(db, userId, env.defaultRoles).generator
  return llmPlanner(new OpenRouter(key, undefined), model, roleReasoning.generator)
}

function instructionOf(settings: Settings): string {
  return (settings.instruction as string | undefined) ?? 'Continue the deck'
}

function tempDeckOptions(row: DeckRow, words: string[], settings: Settings, planner: Planner) {
  return {
    instruction: instructionOf(settings),
    targetLang: row.targetLang,
    sourceLang: row.sourceLang,
    words,
    count: words.length,
    name: `__sentences_${Date.now()}`,
    variant: settings.variant as CharacterVariant | undefined,
    readingScript: settings.readingScript as string | undefined,
    showReadings: settings.showReadings as boolean | undefined,
    disabledExercises: settings.disabledExercises as string[] | undefined,
    pitchAccent: settings.pitchAccent as boolean | undefined,
    sourceLabel: row.name,
    planner,
  }
}

function tempDeckContext(row: DeckRow, settings: Settings) {
  return {
    instruction: instructionOf(settings),
    targetLang: row.targetLang,
    sourceLang: row.sourceLang,
    variant: settings.variant as CharacterVariant | undefined,
    readingScript: settings.readingScript as string | undefined,
    pitchAccent: settings.pitchAccent as boolean | undefined,
  }
}

async function fillTemp(
  row: DeckRow,
  words: string[],
  settings: Settings,
  planner: Planner,
  deckId: DeckId,
): Promise<void> {
  try {
    await fillDeck(db, row.userId, deckId, {
      ctx: tempDeckContext(row, settings),
      opts: { words, count: words.length, knownWords: [], startStep: 0 },
      planner,
    })
  } catch (err) {
    deleteDeck(db, deckId)
    throw err
  }
}

async function generateTemp(
  row: DeckRow,
  words: string[],
  settings: Settings,
  planner: Planner,
): Promise<Cards> {
  const opts = tempDeckOptions(row, words, settings, planner)
  const created = await createDeckForBuild(db, row.userId, opts)
  await fillTemp(row, words, settings, planner, created.deckId)
  const temp = listCards(db, row.userId, created.deckId)
  deleteDeck(db, created.deckId)
  return temp
}

function removeSentences(cards: Cards): number {
  let removed = 0
  for (const c of cards) {
    if (c.payload?.template !== 'sentence') continue
    for (const table of ['srs', 'srs_reviews', 'reviews']) {
      sqlite.run(`delete from ${table} where card_id = ?`, [c.id])
    }
    sqlite.run('delete from cards where id = ?', [c.id])
    removed++
  }
  return removed
}

function insertSentences(row: DeckRow, pending: Pending[]): void {
  for (const e of pending) {
    addCard(db, row.userId, {
      deckId: row.id,
      type: e.type,
      sourceLang: row.sourceLang,
      targetLang: row.targetLang,
      front: e.front,
      back: e.back,
      readings: e.readings,
      tags: e.tags,
      payload: e.payload,
      metadata: e.metadata as never,
      origin: 'llm',
    })
  }
}

function keepComplete(userId: UserId, deckId: DeckId): void {
  const view = curriculumView(db, userId).find((d) => d.deckId === deckId)
  for (const lesson of view?.lessons ?? []) {
    if (lesson.complete) completeLesson(db, userId, lesson.id)
  }
}

function logHead(row: DeckRow, cards: Cards): void {
  const old = cards.filter((c) => c.payload?.template === 'sentence').length
  console.log(`[sentences] ${row.name}: ${stepByWord(cards).size} words, ${old} old sentences`)
}

async function buildPending(
  row: DeckRow,
  words: string[],
  settings: Settings,
  cards: Cards,
): Promise<Pending[]> {
  const started = Date.now()
  const temp = await generateTemp(row, words, settings, await plannerFor(row.userId, row.name))
  const pending = pendingSentences(temp, stepByWord(cards))
  console.log(
    `[sentences] ${row.name}: built ${pending.length} in ${Math.round((Date.now() - started) / 1000)}s`,
  )
  return pending
}

function replaceSentences(row: DeckRow, cards: Cards, pending: Pending[]): void {
  const removed = removeSentences(cards)
  insertSentences(row, pending)
  console.log(`[sentences] ${row.name}: removed ${removed}, added ${pending.length}`)
}

async function rebuildDeck(row: DeckRow): Promise<void> {
  const settings = JSON.parse(row.settingsJson || '{}') as Settings
  const cards = listCards(db, row.userId, row.id)
  const words = wordsOf(settings, cards)
  logHead(row, cards)
  if (words.length === 0) {
    console.log(`[sentences] ${row.name}: no word list, skipping`)
    return
  }
  keepComplete(row.userId, row.id)
  const pending = await buildPending(row, words, settings, cards)
  if (pending.length === 0 || dry) {
    console.log(`[sentences] ${row.name}: ${dry ? 'dry run' : 'nothing generated'}, left untouched`)
    return
  }
  replaceSentences(row, cards, pending)
}

function cleanupTempDecks(): void {
  const rows = sqlite.query('select id from decks where name like ?').all('__sentences%') as {
    id: string
  }[]
  for (const row of rows) deleteDeck(db, row.id as DeckId)
}

cleanupTempDecks()

for (const row of deckRows()) {
  if (only && row.id !== only) continue
  await rebuildDeck(row)
}
sqlite.close()
