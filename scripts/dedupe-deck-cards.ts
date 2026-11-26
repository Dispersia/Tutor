import { homedir } from 'node:os'
import { join } from 'node:path'

process.env.TUTOR_DATA_DIR ||= join(homedir(), '.local/share/tutor')

const { env } = await import('../apps/server/src/env')
const { openDb } = await import('../apps/server/src/db/client')
const { deleteCards, listCards, listDecks } = await import('../apps/server/src/db/repo')
const { wordKey } = await import('../apps/server/src/text/normalize')
import type { ServerCard } from '../apps/server/src/db/repo'

const dry = process.argv.slice(2).includes('--dry')
const { db, sqlite } = openDb(join(env.dataDir, 'tutor.db'))

interface Progress {
  reps: number
  lastReviewAt: number
}

const progress = sqlite.query(
  'select reps, coalesce(last_review_at, 0) as lastReviewAt from srs where card_id = ?',
)

function progressOf(cardId: string): Progress | undefined {
  return progress.get(cardId) as Progress | undefined
}

function templateOf(card: ServerCard): string {
  const template = card.payload?.template
  return typeof template === 'string' ? template : 'vocab'
}

function keyOf(card: ServerCard): string {
  const template = templateOf(card)
  const practice = template === 'grammar' && card.payload?.intro !== true
  const prompt = practice && typeof card.payload?.prompt === 'string' ? card.payload.prompt : ''
  return `${template}|${wordKey(card.back)}|${prompt}`
}

function keepFirst(cards: ServerCard[]): ServerCard {
  return [...cards].sort((a, b) => {
    const pa = progressOf(a.id)
    const pb = progressOf(b.id)
    if (pb && !pa) return 1
    if (pa && !pb) return -1
    const seen = (pb?.lastReviewAt ?? 0) - (pa?.lastReviewAt ?? 0)
    if (seen !== 0) return seen
    return a.createdAt - b.createdAt
  })[0]!
}

let total = 0
for (const deck of listDecks(db)) {
  const groups = new Map<string, ServerCard[]>()
  for (const card of listCards(db, undefined, deck.id)) {
    const key = keyOf(card)
    const group = groups.get(key) ?? []
    group.push(card)
    groups.set(key, group)
  }
  const extras = [...groups.values()].flatMap((group) => {
    const keeper = keepFirst(group)
    return group.filter((card) => card.id !== keeper.id)
  })
  if (extras.length === 0) continue
  total += extras.length
  console.log(`${deck.name}: dropping ${extras.length} duplicate(s)`)
  for (const card of extras) {
    console.log(`  ${templateOf(card).padEnd(8)} ${card.back}  (${card.front})`)
  }
  if (!dry)
    deleteCards(
      db,
      extras.map((card) => card.id),
    )
}

console.log(`${dry ? 'would drop' : 'dropped'} ${total} duplicate card(s)`)
if (!dry) sqlite.close()
