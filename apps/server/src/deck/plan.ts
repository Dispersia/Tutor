import type { OpenRouter, ReasoningEffort } from '../llm/openrouter'
import { parsePitchContour } from '@tutor/core'
import { PLAN_SYSTEM, planPrompt, type PlanRequest } from './planPrompt'
import { bareText } from '../text/normalize'

export type PlanTemplate = 'vocab' | 'sentence' | 'grammar'

export interface PlannedCard {
  template: PlanTemplate
  front: string
  back: string
  reading?: string
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type { PlanRequest } from './planPrompt'

export type Planner = (req: PlanRequest) => Promise<PlannedCard[]>

const PAYLOAD_SCHEMA = {
  type: 'object',
  properties: {
    tokens: { type: 'array', items: { type: 'string' } },
    gloss: { type: 'string' },
    distractors: { type: 'array', items: { type: 'string' } },
    prompt: { type: 'string' },
    answer: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    rule: { type: 'string' },
    explanation: { type: 'string' },
  },
  additionalProperties: false,
}

const METADATA_SCHEMA = {
  type: 'object',
  properties: {
    pitch: {
      type: 'object',
      properties: {
        syllables: { type: 'array', items: { type: 'string' } },
        levels: { type: 'array', items: { type: 'string', enum: ['H', 'L'] } },
        drop: { type: 'integer' },
      },
      required: ['levels'],
      additionalProperties: false,
    },
  },
  additionalProperties: true,
}

export const DECK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          template: { type: 'string', enum: ['vocab', 'sentence', 'grammar'] },
          front: { type: 'string' },
          back: { type: 'string' },
          reading: { type: 'string' },
          payload: PAYLOAD_SCHEMA,
          metadata: METADATA_SCHEMA,
        },
        required: ['template', 'front', 'back'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
}

export const META_MARKERS =
  /\b(note:|grammatically|semantically|n\+1|not introduced|introduced yet|strict n|used to test|test structure|as an ai|i'll use|i will use|per the rules|per rules|known list|skip the)/i

const ASIDE_MARKERS =
  /\b(wait,|correction|corrected|revised|oops|let me|let's|i cannot|i must|however,|actually,)/i

const isAside = (text: string): boolean => META_MARKERS.test(text) || ASIDE_MARKERS.test(text)

export function stripMetaCommentary(text: string): string {
  let out = text.replace(/^\s*(?:translate|translation|meaning|gloss|english)\s*[::]\s*/i, '')
  out = out.replace(/[（([][^)）\]]*[)）\]]/g, (m) => (isAside(m) ? ' ' : m))
  out = out.replace(
    /(?:^|[.。!！?？]\s*|\s[-–—]\s*)(?:note|wait|correction|revised|actually|hmm|oops)\s*[:,：，][\s\S]*$/i,
    (m) => m.match(/^[.。!！?？]/)?.[0] ?? '',
  )
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.。!！?？,，、])/g, '$1')
    .trim()
}

export function tokensMatchBack(tokens: unknown, back: string): boolean {
  if (!Array.isArray(tokens)) return true
  const joined = tokens.filter((t): t is string => typeof t === 'string').join('')
  return bareText(joined) === bareText(back)
}

export function sanitizePlannedCard(card: PlannedCard): PlannedCard | undefined {
  const front = stripMetaCommentary(card.front)
  const back = stripMetaCommentary(card.back)
  if (!front || !back || META_MARKERS.test(front) || META_MARKERS.test(back)) return undefined
  if (back.includes('___')) return undefined
  const payload = cleanPayload(card, back)
  if (payload === null) return undefined
  return { ...card, front, back, payload }
}

function cleanPayload(card: PlannedCard, back: string): Record<string, unknown> | undefined | null {
  if (!card.payload) return undefined
  const payload = { ...card.payload }
  cleanText(payload)
  cleanLists(payload)
  const corrupt =
    card.template === 'sentence' &&
    Array.isArray(payload.tokens) &&
    payload.tokens.length >= 2 &&
    !tokensMatchBack(payload.tokens, back)
  return corrupt ? null : payload
}

function cleanText(payload: Record<string, unknown>): void {
  for (const key of ['gloss', 'prompt', 'rule', 'explanation']) {
    const v = payload[key]
    if (typeof v !== 'string') continue
    const cleaned = stripMetaCommentary(v)
    if (!cleaned || cleaned.length > 200 || META_MARKERS.test(cleaned)) delete payload[key]
    else payload[key] = cleaned
  }
}

function cleanLists(payload: Record<string, unknown>): void {
  if (Array.isArray(payload.options)) {
    payload.options = payload.options
      .map((o) => (typeof o === 'string' ? stripMetaCommentary(o) : o))
      .filter((o) => o !== '')
  }
  if (Array.isArray(payload.tokens)) {
    payload.tokens = payload.tokens
      .map((t) => (typeof t === 'string' ? t.trim() : t))
      .filter((t) => t !== '')
  }
}

export function normalizePlan(raw: unknown): PlannedCard[] {
  const cards = (raw as { cards?: unknown } | undefined)?.cards
  if (!Array.isArray(cards)) return []
  const out: PlannedCard[] = []
  for (const c of cards) {
    const card = toPlanned(c)
    if (card) out.push(card)
  }
  return out
}

function toPlanned(c: unknown): PlannedCard | undefined {
  const card = c as Partial<PlannedCard> & { template?: string }
  if (!card || typeof card.front !== 'string' || typeof card.back !== 'string') return undefined
  const template: PlanTemplate =
    card.template === 'sentence' || card.template === 'grammar' ? card.template : 'vocab'
  return sanitizePlannedCard({
    template,
    front: card.front,
    back: card.back,
    reading: typeof card.reading === 'string' ? card.reading : undefined,
    payload:
      card.payload && typeof card.payload === 'object'
        ? (card.payload as Record<string, unknown>)
        : undefined,
    metadata: normalizeMetadata(card.metadata),
  })
}

function normalizeMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, unknown> = {}
  const pitch = parsePitchContour((raw as Record<string, unknown>).pitch)
  if (pitch) out.pitch = pitch
  return Object.keys(out).length ? out : undefined
}

const PLAN_TEMPERATURE = 0.6

export function llmPlanner(or: OpenRouter, model: string, reasoning: ReasoningEffort): Planner {
  return async (req) => {
    const { json } = await or.chatJSON({
      model,
      schema: DECK_SCHEMA,
      schemaName: 'deck',
      reasoning,
      temperature: PLAN_TEMPERATURE,
      messages: [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: planPrompt(req) },
      ],
    })
    return normalizePlan(json)
  }
}
