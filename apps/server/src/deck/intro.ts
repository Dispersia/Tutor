import { wordKey } from '../text/normalize'
import type { PlannedCard } from './plan'

export function acceptPlanned(
  planned: PlannedCard[],
  requested: string[],
): { cards: PlannedCard[]; introduced: number } {
  const canonical = new Map(requested.map((w) => [wordKey(w), w]))
  const wordOf = (c: PlannedCard) => canonical.get(wordKey(c.back))
  const intro = introductions(planned, wordOf)
  const introduced = leadRun(requested, intro)
  const open = new Set(requested.slice(0, introduced))
  const chosen = new Set([...open].map((w) => intro.get(w)))
  return { cards: keptCards(planned, wordOf, chosen), introduced }
}

function leadRun(requested: string[], intro: Map<string, PlannedCard>): number {
  let n = 0
  while (n < requested.length && intro.has(requested[n]!)) n++
  return n
}

function keptCards(
  planned: PlannedCard[],
  wordOf: (c: PlannedCard) => string | undefined,
  chosen: Set<PlannedCard | undefined>,
): PlannedCard[] {
  const cards: PlannedCard[] = []
  for (const c of planned) {
    const word = wordOf(c)
    if (word === undefined) {
      if (c.template !== 'vocab') cards.push(c)
    } else if (chosen.has(c)) {
      cards.push(chosenIntro(c, word))
    } else if (c.template === 'grammar') {
      cards.push(c)
    }
  }
  return cards
}

function introductions(
  planned: PlannedCard[],
  wordOf: (c: PlannedCard) => string | undefined,
): Map<string, PlannedCard> {
  const vocab = firstVocab(planned, wordOf)
  const intro = new Map<string, PlannedCard>()
  for (const c of planned) {
    const word = wordOf(c)
    if (word === undefined) continue
    if (c.template === 'vocab') {
      if (!intro.has(word)) intro.set(word, c)
    } else if (c.template === 'grammar' && isPoint(c, word, vocab)) {
      prefer(intro, word, c)
    }
  }
  return intro
}

function isPoint(card: PlannedCard, word: string, vocab: Set<string>): boolean {
  return card.payload?.intro === true || !vocab.has(word)
}

function prefer(intro: Map<string, PlannedCard>, word: string, card: PlannedCard): void {
  const prev = intro.get(word)
  const declared = card.payload?.intro === true
  if (!prev || (prev.template === 'vocab' && declared)) intro.set(word, card)
}

function firstVocab(
  planned: PlannedCard[],
  wordOf: (c: PlannedCard) => string | undefined,
): Set<string> {
  const vocab = new Set<string>()
  for (const c of planned) {
    if (c.template !== 'vocab') continue
    const word = wordOf(c)
    if (word !== undefined) vocab.add(word)
  }
  return vocab
}

function chosenIntro(card: PlannedCard, word: string): PlannedCard {
  if (card.template === 'vocab') return { ...card, back: word }
  return { ...card, payload: { ...(card.payload ?? {}), intro: true } }
}
