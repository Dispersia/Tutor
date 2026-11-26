import type { UserId, DeckId, SessionId } from '../ids'
import type { CardType } from '@tutor/core'
import type { Deps } from '../context'
import {
  addCard,
  getCard,
  getDeck,
  listCards,
  listDecks,
  listMessages,
  type PublicUser,
  type ServerCard,
} from '../db/repo'
import { verifyCard } from '../exercises/verify'
import { isUtterance } from '../exercises/payload'
import { loadLearnerData } from '../services/context'
import { knownWordsFor, type LoadedCards } from '../services/srs'
import { readStudyPrefs, type StudyPrefs } from '../services/study'
import { langName } from '../llm/prompts'
import {
  applyDictionaryPitch,
  applyDictionaryReading,
  maxStep,
  readingsForPlanned,
  type DeckContext,
} from './context'
import { asCard, verifyContext } from './exampleCards'
import { sanitizePlannedCard, storedTemplate, type ChatCardPlan, type PlannedCard } from './plan'
import { chatPlannerFor } from './planner'

export const CHAT_CARD_TAG = 'chat'
export const CHAT_CARD_FAILED = 'That card could not be saved.'

export interface ChatCardInput {
  deckId: DeckId
  targetLang: string
  card: PlannedCard
}

export interface ChatCardSuggestion extends ChatCardInput {
  deckName: string
}

type DeckRow = ReturnType<typeof listDecks>[number]
type Deck = NonNullable<ReturnType<typeof getDeck>>

interface Exchange {
  learnerText: string
  replyText: string
}

export async function suggestChatCard(
  deps: Deps,
  user: PublicUser,
  sessionId: SessionId,
): Promise<ChatCardSuggestion | undefined> {
  const exchange = lastExchange(deps, sessionId)
  const decks = listDecks(deps.db, user.id)
  if (!exchange || decks.length === 0) return undefined
  const planner = await chatPlannerFor(deps, user.id)
  if (!planner) return undefined
  const langs = deckLanguages(decks)
  const deck = defaultDeck(decks, readStudyPrefs(deps.db, user.id))
  const plan = await planner(chatRequest(deps, user, exchange, langs, deck)).catch(() => undefined)
  return firstSuggestion(plan, decks, deck.targetLang)
}

export async function saveChatCard(
  deps: Deps,
  user: PublicUser,
  suggestion: ChatCardInput,
): Promise<ServerCard | undefined> {
  const deck = getDeck(deps.db, suggestion.deckId, user.id)
  if (!deck || deck.targetLang !== suggestion.targetLang) return undefined
  const card = sanitizePlannedCard(suggestion.card)
  if (!card) return undefined
  const known = knownWordsFor(deps.db, user.id, deck.targetLang)
  if (!(await verifiedCard(deck, card, known))) return undefined
  const saved = persistChatCard(deps, user.id, deck, card)
  if (saved) enqueueAudio(deps, user.id, saved)
  return saved
}

function lastExchange(deps: Deps, sessionId: SessionId): Exchange | undefined {
  const msgs = listMessages(deps.db, sessionId)
  const learner = [...msgs].reverse().find((m) => m.role === 'user' && m.text.trim() !== '')
  if (!learner) return undefined
  const reply = [...msgs]
    .reverse()
    .find((m) => m.role === 'assistant' && m.text.trim() !== '' && m.createdAt >= learner.createdAt)
  return { learnerText: learner.text, replyText: reply?.text ?? '' }
}

function deckLanguages(decks: DeckRow[]): { code: string; name: string }[] {
  const seen = new Set<string>()
  const out: { code: string; name: string }[] = []
  for (const d of decks) {
    if (seen.has(d.targetLang)) continue
    seen.add(d.targetLang)
    out.push({ code: d.targetLang, name: langName(d.targetLang) })
  }
  return out
}

function defaultDeck(decks: DeckRow[], prefs: StudyPrefs): DeckRow {
  const active = decks.find((d) => d.id === prefs.activeDeckId)
  return active ?? decks[0]!
}

function chatRequest(
  deps: Deps,
  user: PublicUser,
  exchange: Exchange,
  langs: { code: string; name: string }[],
  deck: DeckRow,
) {
  const data = loadLearnerData(deps.db, user.id)
  return {
    learnerText: exchange.learnerText,
    replyText: exchange.replyText,
    languages: langs,
    defaultLang: deck.targetLang,
    knownWords: knownPerLang(deps, user.id, langs, data),
    variant: deck.settings.variant,
    readingScript: deck.settings.readingScript,
    pitchAccent: deck.settings.pitchAccent,
  }
}

function knownPerLang(
  deps: Deps,
  userId: UserId,
  langs: { code: string }[],
  data: LoadedCards,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const l of langs) out[l.code] = [...knownWordsFor(deps.db, userId, l.code, data)]
  return out
}

function firstSuggestion(
  plan: ChatCardPlan | undefined,
  decks: DeckRow[],
  defaultLang: string,
): ChatCardSuggestion | undefined {
  const card = plan?.cards[0]
  const deck = decks.find((d) => d.targetLang === (plan?.targetLang ?? defaultLang))
  if (!card || !deck) return undefined
  const clean = sanitizePlannedCard(card)
  return clean
    ? { deckId: deck.id, deckName: deck.name, targetLang: deck.targetLang, card: clean }
    : undefined
}

async function verifiedCard(deck: Deck, card: PlannedCard, known: Set<string>): Promise<boolean> {
  const ctx = deckContext(deck)
  const verdict = await verifyCard(verifyContext(asCard(card, ctx), ctx, known))
  return verdict.ok
}

function deckContext(deck: Deck): DeckContext {
  return {
    instruction: deck.settings.instruction ?? '',
    targetLang: deck.targetLang,
    sourceLang: deck.sourceLang,
    variant: deck.settings.variant,
    readingScript: deck.settings.readingScript,
    pitchAccent: deck.settings.pitchAccent,
    hints: deck.settings.hints,
  }
}

function persistChatCard(
  deps: Deps,
  userId: UserId,
  deck: Deck,
  card: PlannedCard,
): ServerCard | undefined {
  const step = maxStep(listCards(deps.db, userId, deck.id)) + 1
  const row = addCard(deps.db, userId, chatCard(deck, userId, card, step))
  return getCard(deps.db, row.id, userId)
}

function chatCard(deck: Deck, userId: UserId, card: PlannedCard, step: number) {
  const settings = deck.settings
  applyDictionaryPitch(deck.targetLang, settings.pitchAccent, [card])
  applyDictionaryReading(deck.targetLang, settings.readingScript, settings.hints, [card])
  return chatRow(deck, userId, card, step)
}

function chatRow(deck: Deck, userId: UserId, card: PlannedCard, step: number) {
  const template = storedTemplate(card)
  const script = deck.settings.readingScript
  return {
    deckId: deck.id,
    type: cardType(template),
    sourceLang: deck.sourceLang,
    targetLang: deck.targetLang,
    front: card.front,
    back: card.back,
    readings: readingsForPlanned(deck.targetLang, card.reading, script, card.back),
    tags: [deck.targetLang, template, CHAT_CARD_TAG],
    payload: { ...(card.payload ?? {}), template, step },
    metadata: card.metadata,
    origin: 'llm' as const,
    privateTo: userId,
  }
}

function cardType(template: PlannedCard['template']): CardType {
  if (template === 'sentence') return 'phrase'
  if (template === 'grammar') return 'grammar'
  return 'vocab'
}

function enqueueAudio(deps: Deps, userId: UserId, card: ServerCard): void {
  if (!isUtterance(card)) return
  deps.audio?.enqueue([{ userId, text: card.back, language: card.targetLang }])
}
