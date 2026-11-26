import type { UserId, DeckId, CardId } from '../ids'
import type { ExerciseContext } from '@tutor/core'
import type { Db } from '../db/client'
import { deleteCards, getCard, listCards, updateCard, type ServerCard } from '../db/repo'
import { verifyCard } from '../exercises/verify'
import { unseenParts } from './context'
import type { PlannedCard } from './plan'

export interface AuditIssue {
  cardId: CardId
  type: string
  front: string
  back: string
  reasons: string[]
  prune: string[]
  strip: string[]
}

export interface DeckAudit {
  checked: number
  issues: AuditIssue[]
}

export async function scanDeck(db: Db, userId: UserId, deckId: DeckId): Promise<DeckAudit> {
  const cards = listCards(db, userId, deckId)
  const vocab = vocabSteps(cards)
  const issues: AuditIssue[] = []
  for (const card of cards) {
    if (card.type === 'vocab') continue
    const issue = await issueFor(card, vocab)
    if (issue) issues.push(issue)
  }
  return { checked: cards.length, issues }
}

export function applyAudit(db: Db, issues: AuditIssue[]): { dropped: number; pruned: number } {
  const drops = issues.filter((issue) => issue.reasons.length > 0)
  const fixes = issues.filter((issue) => issue.reasons.length === 0)
  deleteCards(
    db,
    drops.map((issue) => issue.cardId),
  )
  for (const issue of fixes) fixCard(db, issue)
  return { dropped: drops.length, pruned: fixes.length }
}

function fixCard(db: Db, issue: AuditIssue): void {
  const card = getCard(db, issue.cardId)
  if (!card) return
  const payload = { ...card.payload }
  const distractors = payload.distractors
  if (Array.isArray(distractors)) {
    payload.distractors = distractors.filter(
      (d: unknown) => !(typeof d === 'string' && issue.prune.includes(d)),
    )
  }
  for (const key of issue.strip) delete payload[key]
  updateCard(db, issue.cardId, { payload })
}

async function issueFor(
  card: ServerCard,
  vocab: Map<number, string>,
): Promise<AuditIssue | undefined> {
  const known = knownAt(vocab, stepOf(card))
  const parts = unseenParts(plannedCard(card), new Set(known))
  const reasons = await problems(card, known, parts.words)
  const strip = clueStrip(card)
  if (!reasons.length && !parts.distractors.length && !strip.length) return undefined
  return issueOf(card, reasons, parts.distractors, strip)
}

async function problems(card: ServerCard, known: string[], unseen: string[]): Promise<string[]> {
  const verdict = await verifyCard(exerciseCtx(card, known))
  const reasons = [...verdict.failures]
  if (unseen.length) reasons.unshift(`uses words not yet met: ${unseen.join(' ')}`)
  return reasons
}

function issueOf(
  card: ServerCard,
  reasons: string[],
  prune: string[],
  strip: string[],
): AuditIssue {
  return {
    cardId: card.id,
    type: card.type,
    front: card.front,
    back: card.back,
    reasons,
    prune,
    strip,
  }
}

function clueStrip(card: ServerCard): string[] {
  if (card.type !== 'grammar') return []
  const answer = typeof card.payload?.answer === 'string' ? card.payload.answer : card.back
  if (!answer) return []
  const rule = typeof card.payload?.rule === 'string' ? card.payload.rule : ''
  return rule.includes(answer) ? ['rule'] : []
}

function vocabSteps(cards: ServerCard[]): Map<number, string> {
  const byStep = new Map<number, string>()
  for (const card of cards) {
    const step = card.payload?.step
    if (typeof step !== 'number') continue
    if (card.type !== 'vocab' && card.payload?.intro !== true) continue
    if (Array.isArray(card.payload?.tokens)) continue
    byStep.set(step, card.back)
  }
  return byStep
}

function knownAt(vocab: Map<number, string>, step: number): string[] {
  const out: string[] = []
  for (const [at, word] of vocab) if (at <= step) out.push(word)
  return out
}

function stepOf(card: ServerCard): number {
  const step = card.payload?.step
  return typeof step === 'number' ? step : 0
}

function plannedCard(card: ServerCard): PlannedCard {
  const template = card.payload?.template
  return {
    template: template === 'sentence' || template === 'grammar' ? template : 'vocab',
    front: card.front,
    back: card.back,
    payload: card.payload,
  }
}

function exerciseCtx(card: ServerCard, known: string[]): ExerciseContext {
  return {
    card,
    learner: { id: '', nativeLang: card.sourceLang, targetLang: card.targetLang, level: '' },
    distractors: [],
    readings: card.readings,
    known: [...known, card.back],
    seen: [...known],
    showReadings: false,
  }
}
