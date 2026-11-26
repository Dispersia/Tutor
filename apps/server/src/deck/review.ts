import { langName } from '../llm/prompts'
import type { ChatMessage, OpenRouter, ReasoningEffort } from '../llm/openrouter'
import type { PlannedCard } from './plan'

export interface ReviewRequest {
  instruction: string
  targetLang: string
  sourceLang: string
  words: string[]
  knownWords: string[]
  cards: PlannedCard[]
}

export type Reviewer = (req: ReviewRequest) => Promise<PlannedCard[]>

export interface ReviewBatch extends ReviewRequest {
  reviewer?: Reviewer
}

export async function reviewBatch(req: ReviewBatch): Promise<PlannedCard[]> {
  if (!req.reviewer || !req.cards.length) return req.cards
  try {
    return await req.reviewer(req)
  } catch (err) {
    console.warn(`[deck] the review pass failed — ${(err as Error).message}`)
    return req.cards
  }
}

const REVIEW_SYSTEM = `You check one batch of a language-learning deck before it is saved. You are a strict native-speaker editor: only correct cards are kept.

For every card, judge:
- The meaning (front) matches the word or sentence (back) exactly, with no wrong sense.
- The target-language text is grammatical and natural, the way a native speaker writes it, in the deck's script.
- The reading is the correct pronunciation. Fix it, or mark the card wrong, if it is not.
- A sentence or grammar prompt uses only words the learner has already met plus the one it introduces; every word must be on the known list or the batch's earlier cards. Drop any card that reaches past them.
- A grammar blank has exactly one right answer, a single word for it, and payload.options that include that answer.
- The sentence is one a native would really say, not a word-by-word translation.
- A sentence must say something real. Drop one that is grammatical but meaningless or that no native would ever say ("I am me.", "I am you.", "This is he."); a missing sentence is better than a silly one.
- A grammar card must teach the point, not just name it: it must carry payload.prompt (a full sentence with exactly one ___), payload.answer and payload.options, and its explanation has to say what it means, when each form is used, and the mistake learners make. Drop one with no blank, a bare-label explanation, or a form it never explains. Check the direction of every condition — which form follows a consonant and which a vowel — and fix or drop a card that states it the wrong way round.

Answer with one verdict per card you were given, in order:
- "keep" when the card is correct; leave "problems" empty.
- "fix" when only a reading or the learner-language meaning is wrong and the card is worth keeping: put the corrected reading in "reading" and the corrected meaning in "front".
- "drop" when the card is wrong in a way you cannot fix: bad grammar, a sentence that does not mean what it says, a word used wrongly, an invented word.

List what is wrong in "problems", in the learner's language, one short phrase each. Return "reading" and "front" only when you are changing them; otherwise return empty strings.`

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          action: { type: 'string', enum: ['keep', 'fix', 'drop'] },
          problems: { type: 'array', items: { type: 'string' } },
          reading: { type: 'string' },
          front: { type: 'string' },
        },
        required: ['index', 'action', 'problems', 'reading', 'front'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
}

interface Verdict {
  index: number
  action: 'keep' | 'fix' | 'drop'
  problems?: string[]
  reading?: string
  front?: string
}

export function reviewMessages(req: ReviewRequest): ChatMessage[] {
  return [
    { role: 'system', content: REVIEW_SYSTEM },
    { role: 'user', content: reviewPrompt(req) },
  ]
}

function reviewPrompt(req: ReviewRequest): string {
  return [
    `Instruction: ${req.instruction}`,
    `Target language: ${langName(req.targetLang)}. Learner's language: ${langName(req.sourceLang)}.`,
    `Words the learner has already met: ${req.knownWords.join(' ') || 'none yet'}`,
    `New words in this batch, in order: ${req.words.join(' ')}`,
    '',
    `Cards to check (${req.cards.length}):`,
    ...req.cards.map(cardLine),
  ].join('\n')
}

function cardLine(card: PlannedCard, index: number): string {
  const head = `${index}. ${card.template} | front: ${card.front} | back: ${card.back}`
  return [head, detailLine(card)].filter(Boolean).join('\n   ')
}

function detailLine(card: PlannedCard): string {
  const p = card.payload ?? {}
  const parts: string[] = []
  if (card.reading) parts.push(`reading: ${card.reading}`)
  if (Array.isArray(p.tokens)) parts.push(`tokens: ${p.tokens.join(' ')}`)
  if (Array.isArray(p.distractors) && p.distractors.length) {
    parts.push(`distractors: ${p.distractors.join(' ')}`)
  }
  if (typeof p.prompt === 'string') parts.push(`prompt: ${p.prompt}`)
  if (typeof p.answer === 'string') parts.push(`answer: ${p.answer}`)
  if (Array.isArray(p.options)) parts.push(`options: ${p.options.join(' / ')}`)
  if (typeof p.gloss === 'string') parts.push(`gloss: ${p.gloss}`)
  return parts.join(' | ')
}

export function applyVerdicts(cards: PlannedCard[], verdicts: Verdict[]): PlannedCard[] {
  const byIndex = new Map<number, Verdict>()
  for (const v of verdicts) {
    if (Number.isInteger(v?.index)) byIndex.set(v.index, v)
  }
  const out: PlannedCard[] = []
  cards.forEach((card, i) => {
    const verdict = byIndex.get(i)
    if (!verdict) {
      out.push(card)
      return
    }
    const fixed = fixOf(card, verdict)
    if (fixed) out.push(fixed)
    else if (verdict.action !== 'drop' && !verdict.problems?.length) out.push(card)
  })
  return out
}

function fixOf(card: PlannedCard, verdict: Verdict): PlannedCard | undefined {
  const reading = verdict.reading?.trim()
  const front = verdict.front?.trim()
  if (!reading && !front) return undefined
  return { ...card, reading: reading || card.reading, front: front || card.front }
}

const REVIEW_TEMPERATURE = 0.2

export function llmReviewer(or: OpenRouter, model: string, reasoning: ReasoningEffort): Reviewer {
  return async (req) => {
    if (!req.cards.length) return req.cards
    const { json } = await or.chatJSON<{ verdicts: Verdict[] }>({
      model,
      schema: REVIEW_SCHEMA,
      schemaName: 'review',
      reasoning,
      temperature: REVIEW_TEMPERATURE,
      messages: reviewMessages(req),
    })
    return applyVerdicts(req.cards, json.verdicts ?? [])
  }
}
