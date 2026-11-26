import type { OpenRouter, ReasoningEffort } from '../llm/openrouter'
import { parsePitchContour } from '@tutor/core'
import {
  CHAT_CARD_SYSTEM,
  PLAN_SYSTEM,
  chatCardPrompt,
  planPrompt,
  type ChatCardRequest,
  type PlanRequest,
} from './planPrompt'
import { answerRepeatsPrompt, promptEndsAtBlank } from '../exercises/shared'
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

export function storedTemplate(card: PlannedCard): PlanTemplate {
  if (card.template !== 'sentence') return card.template
  const tokens = Array.isArray(card.payload?.tokens) ? card.payload.tokens : []
  return tokens.length === 1 ? 'vocab' : 'sentence'
}

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
    intro: { type: 'boolean' },
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

const CARD_FIELDS = {
  front: { type: 'string' },
  back: { type: 'string' },
  reading: { type: 'string' },
  metadata: METADATA_SCHEMA,
}

function cardVariant(template: string, payloadRequired: string[] = []) {
  return {
    type: 'object',
    properties: {
      template: { const: template },
      ...CARD_FIELDS,
      payload: { ...PAYLOAD_SCHEMA, required: payloadRequired },
    },
    required: ['template', 'front', 'back'],
    additionalProperties: false,
  }
}

function cardItems() {
  return {
    anyOf: [cardVariant('vocab'), cardVariant('sentence'), cardVariant('grammar', ['explanation'])],
  }
}

export const DECK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    cards: { type: 'array', items: cardItems() },
  },
  required: ['cards'],
  additionalProperties: false,
}

export const CHAT_CARD_SCHEMA = {
  type: 'object',
  properties: {
    targetLang: { type: 'string' },
    cards: { type: 'array', items: cardItems() },
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
  if (card.template === 'grammar' && !grammarHasBlank(payload)) {
    if (payload?.intro === true)
      return { ...card, template: 'vocab', front, back, payload: teachingOf(payload) }
    return undefined
  }
  if (card.template === 'grammar' && payload?.intro === true && !hasExplanation(payload))
    return undefined
  return { ...card, front, back, payload }
}

export const MIN_EXPLANATION = 20

function teachingOf(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const kept: Record<string, unknown> = {}
  for (const key of ['explanation', 'example']) {
    if (payload?.[key] !== undefined) kept[key] = payload[key]
  }
  return Object.keys(kept).length ? kept : undefined
}

function hasExplanation(payload: Record<string, unknown> | undefined): boolean {
  const explanation = typeof payload?.explanation === 'string' ? payload.explanation.trim() : ''
  return explanation.length >= MIN_EXPLANATION
}

function grammarHasBlank(payload: Record<string, unknown> | undefined): boolean {
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : ''
  const answer = typeof payload?.answer === 'string' ? payload.answer : ''
  return prompt.includes('___') && answer.length > 0
}

function cleanPayload(card: PlannedCard, back: string): Record<string, unknown> | undefined | null {
  if (!card.payload) return undefined
  const payload = { ...card.payload }
  cleanText(payload)
  cleanLists(payload)
  if (card.template === 'grammar') return cleanGrammar(card, payload, back)
  const corrupt =
    card.template === 'sentence' &&
    Array.isArray(payload.tokens) &&
    payload.tokens.length >= 2 &&
    !tokensMatchBack(payload.tokens, back)
  return corrupt ? null : payload
}

function cleanGrammar(
  card: PlannedCard,
  payload: Record<string, unknown>,
  back: string,
): Record<string, unknown> | null {
  const answer = typeof payload.answer === 'string' ? payload.answer : back
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
  if (promptEndsAtBlank(prompt) || answerRepeatsPrompt(prompt, answer)) return null
  if (typeof payload.rule === 'string' && payload.rule.includes(answer)) delete payload.rule
  return payload
}

const TEXT_LIMITS: Record<string, number> = {
  gloss: 200,
  prompt: 200,
  rule: 120,
  explanation: 800,
}

function cleanText(payload: Record<string, unknown>): void {
  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    const value = payload[key]
    if (typeof value !== 'string') continue
    const cleaned = stripMetaCommentary(value)
    if (validText(key, cleaned, limit)) payload[key] = cleaned
    else delete payload[key]
  }
}

function validText(key: string, text: string, limit: number): boolean {
  if (!text || text.length > limit) return false
  return key === 'explanation' || !META_MARKERS.test(text)
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

export function normalizePlan(raw: unknown, targetLang?: string): PlannedCard[] {
  const cards = (raw as { cards?: unknown } | undefined)?.cards
  if (!Array.isArray(cards)) return []
  const out: PlannedCard[] = []
  for (const c of cards) {
    const card = toPlanned(c, targetLang)
    if (card) out.push(card)
  }
  return out
}

function toPlanned(c: unknown, targetLang?: string): PlannedCard | undefined {
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
    metadata: normalizeMetadata(card.metadata, targetLang),
  })
}

function normalizeMetadata(raw: unknown, targetLang?: string): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  if (targetLang && targetLang !== 'ja') return undefined
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
    return normalizePlan(json, req.targetLang)
  }
}

export interface ChatCardPlan {
  targetLang?: string
  cards: PlannedCard[]
}

export type ChatPlanner = (req: ChatCardRequest) => Promise<ChatCardPlan>

export function normalizeChatPlan(raw: unknown, targetLang?: string): ChatCardPlan {
  const lang = (raw as { targetLang?: unknown } | undefined)?.targetLang
  return {
    targetLang: typeof lang === 'string' && lang.trim() ? lang.trim().toLowerCase() : undefined,
    cards: normalizePlan(raw, targetLang),
  }
}

const CHAT_PLAN_TEMPERATURE = 0.4

export function llmChatPlanner(
  or: OpenRouter,
  model: string,
  reasoning: ReasoningEffort,
): ChatPlanner {
  return async (req) => {
    const { json } = await or.chatJSON({
      model,
      schema: CHAT_CARD_SCHEMA,
      schemaName: 'chat_card',
      reasoning,
      temperature: CHAT_PLAN_TEMPERATURE,
      messages: [
        { role: 'system', content: CHAT_CARD_SYSTEM },
        { role: 'user', content: chatCardPrompt(req) },
      ],
    })
    return normalizeChatPlan(json, req.defaultLang)
  }
}
