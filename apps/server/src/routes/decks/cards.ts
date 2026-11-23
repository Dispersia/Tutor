import { toDeckId, toCardId, type UserId } from '../../ids'
import { parsePitchContour } from '@tutor/core'
import type { Context } from 'hono'
import type { App, AppEnv, Deps } from '../../context'
import { addCard, getCard, getDeck, listCards, updateCard } from '../../db/repo'
import { jsonBody, num, obj, str, strRecord } from '../body'
import { deckView } from './view'
import { fail } from '../errors'

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
  const deck = getDeck(deps.db, toDeckId(String(c.req.param('id'))))
  if (!deck) return fail(c, 404, 'not found')
  return c.json({ deck: deckView(deck), cards: listCards(deps.db, user.id, deck.id) })
}

async function addCardHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const deck = getDeck(deps.db, toDeckId(String(c.req.param('id'))))
  if (!deck) return fail(c, 404, 'not found')
  const body = readNewCard(await jsonBody(c))
  const front = body.front?.trim()
  const back = body.back?.trim()
  if (!front || !back) return fail(c, 400, 'front and back are required')
  const step = stepFor(listCards(deps.db, user.id, deck.id), body.step)
  const card = insertCard({ deps, userId: user.id, deck, step, front, back, body })
  deps.audio?.enqueue([{ userId: user.id, text: card.back, language: card.targetLang }])
  return c.json({ card: getCard(deps.db, card.id, user.id), step }, 201)
}

interface NewCardCtx {
  deps: Deps
  userId: UserId
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

async function patchCardHandler(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const cardId = toCardId(String(c.req.param('cardId')))
  const card = getCard(deps.db, cardId, user.id)
  if (!card || card.deckId !== String(c.req.param('id'))) return fail(c, 404, 'not found')
  updateCard(deps.db, cardId, cardPatch(card.metadata, await jsonBody(c)))
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

function readingBag(targetLang: string, reading?: string): Record<string, string> {
  if (!reading) return {}
  if (targetLang === 'ja') return { kana: reading }
  if (targetLang === 'zh' || targetLang === 'yue') return { zhuyin: reading }
  return { reading }
}

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

function canonicalPitch(merged: Record<string, unknown>): Record<string, unknown> {
  if (!('pitch' in merged)) return merged
  const pitch = parsePitchContour(merged.pitch)
  if (pitch) merged.pitch = pitch
  else delete merged.pitch
  return merged
}
