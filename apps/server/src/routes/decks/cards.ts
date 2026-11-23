/**
 * A deck's cards: read them, add one by hand and edit one (docs/DESIGN.md §12.4).
 * The same "add a card" endpoint backs the automatic n+1 reinforcement.
 */

import { parsePitchContour } from '@tutor/core'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { addCard, getCard, getDeck, listCards, updateCard } from '../../db/repo'
import { jsonBody, num, obj, str, strRecord } from '../body'
import { deckView } from './view'

/** The deck row as `getDeck` returns it. */
type Deck = NonNullable<ReturnType<typeof getDeck>>

interface NewCardBody {
  front?: string
  back?: string
  type?: string
  reading?: string
  step?: number
  payload?: Record<string, unknown>
}

interface PatchBody {
  front?: string
  back?: string
  readings?: Record<string, string>
  metadata?: Record<string, unknown>
}

/** Reads a hand-authored card from the request body. */
function readNewCard(body: Record<string, unknown>): NewCardBody {
  return {
    front: str(body, 'front'),
    back: str(body, 'back'),
    type: str(body, 'type'),
    reading: str(body, 'reading'),
    step: num(body, 'step'),
    payload: obj(body, 'payload'),
  }
}

export function registerDeckCards(app: App) {
  app.get('/api/decks/:id/cards', (c) => listCardsHandler(c))
  app.post('/api/decks/:id/cards', (c) => addCardHandler(c))
  app.patch('/api/decks/:id/cards/:cardId', (c) => patchCardHandler(c))
}

function listCardsHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deck = getDeck(deps.db, String(c.req.param('id')), user.id)
  if (!deck) return c.json({ error: 'not found' }, 404)
  return c.json({ deck: deckView(deck), cards: listCards(deps.db, user.id, deck.id) })
}

/**
 * Add a single card to a deck. With a `step` it joins that lesson — the n+1
 * group, so a new sentence card can sit beside the word it reinforces. Without
 * one it appends a fresh step at the end. Used by hand-authoring and by the
 * automatic reinforcement that fires when a card keeps lapsing.
 */
async function addCardHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deck = getDeck(deps.db, String(c.req.param('id')), user.id)
  if (!deck) return c.json({ error: 'not found' }, 404)
  const body = readNewCard(await jsonBody(c))
  const front = body.front?.trim()
  const back = body.back?.trim()
  if (!front || !back) return c.json({ error: 'front and back are required' }, 400)
  const step = stepFor(listCards(deps.db, user.id, deck.id), body.step)
  const card = insertCard({ deps, userId: user.id, deck, step, front, back, body })
  // Record the card's audio now (background), so its listening card streams
  // from disk on the first play instead of waking the TTS model.
  deps.audio?.enqueue([{ userId: user.id, text: card.back, language: card.targetLang }])
  return c.json({ card: getCard(deps.db, card.id, user.id), step }, 201)
}

interface NewCardCtx {
  deps: Deps
  userId: string
  deck: Deck
  step: number
  front: string
  back: string
  body: NewCardBody
}

function insertCard(ctx: NewCardCtx) {
  const { deps, userId, deck, body } = ctx
  const template = body.type?.trim() || 'vocab'
  return addCard(deps.db, userId, {
    deckId: deck.id,
    type: template as never,
    sourceLang: deck.sourceLang,
    targetLang: deck.targetLang,
    front: ctx.front,
    back: ctx.back,
    readings: readingBag(deck.targetLang, body.reading?.trim()),
    tags: [deck.targetLang, template],
    payload: { ...(body.payload ?? {}), template, step: ctx.step },
    origin: 'manual',
  })
}

/**
 * Update a card's own content. Metadata is the language-agnostic annotation
 * bag (pitch accent, radicals, …); it is merged by key so one annotation can
 * be edited without dropping the others.
 */
async function patchCardHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const cardId = String(c.req.param('cardId'))
  const card = getCard(deps.db, cardId, user.id)
  if (!card || card.deckId !== String(c.req.param('id'))) return c.json({ error: 'not found' }, 404)
  updateCard(deps.db, cardId, user.id, cardPatch(card.metadata, await jsonBody(c)))
  return c.json({ card: getCard(deps.db, cardId, user.id) })
}

function cardPatch(current: Record<string, unknown>, body: Record<string, unknown>): PatchBody {
  const patch: PatchBody = {}
  const front = str(body, 'front')
  if (front !== undefined) patch.front = front
  const back = str(body, 'back')
  if (back !== undefined) patch.back = back
  const readings = strRecord(body, 'readings')
  if (readings) patch.readings = readings
  const metadata = obj(body, 'metadata')
  if (metadata) patch.metadata = mergeMetadata(current, metadata)
  return patch
}

/** The step a new card joins: the requested one, else one past the deck's last. */
function stepFor(cards: { payload?: Record<string, unknown> }[], requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.max(1, Math.round(requested))
  }
  const maxStep = cards.reduce(
    (m, card) => Math.max(m, typeof card.payload?.step === 'number' ? card.payload.step : 0),
    0,
  )
  return maxStep + 1
}

/** The reading bag for a hand-typed reading, keyed by the target language. */
function readingBag(targetLang: string, reading?: string): Record<string, string> {
  if (!reading) return {}
  if (targetLang === 'ja') return { kana: reading }
  if (targetLang === 'zh' || targetLang === 'yue') return { zhuyin: reading }
  return { reading }
}

/** Merge annotations by key; an explicit `null` removes one (pitch kept canonical). */
function mergeMetadata(
  current: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(update)) {
    if (value === null) delete merged[key]
    else merged[key] = value
  }
  return canonicalPitch(merged)
}

/** Keep the built-in pitch contour canonical so the UI can render it. */
function canonicalPitch(merged: Record<string, unknown>): Record<string, unknown> {
  if (!('pitch' in merged)) return merged
  const pitch = parsePitchContour(merged.pitch)
  if (pitch) merged.pitch = pitch
  else delete merged.pitch
  return merged
}
