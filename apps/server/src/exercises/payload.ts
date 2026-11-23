/** Reading a card payload: tokens, glosses and the utterance test. */

import type { Card } from '@tutor/core'

// --- free conversation turn --------------------------------------------------

/** Strip spaces, punctuation and symbols so “你好。” and “你好” compare equal. */
export const bare = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()

/** Ordered target-language tokens a sentence card carries in its payload. */
export function payloadTokens(card: Card): string[] {
  const t = card.payload?.tokens
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

/** True when the card carries its own segmented sentence (works in any language). */
export const hasPayloadSentence = (card: Card): boolean => payloadTokens(card).length >= 2

/**
 * True when the card already teaches a whole utterance rather than a word. A
 * phrase card, or a sentence card with payload tokens, needs no "make a sentence
 * using it" drill — the card *is* the sentence.
 */
export const isUtterance = (card: Card): boolean =>
  card.type === 'phrase' || hasPayloadSentence(card)

// --- grammar: apply a rule to a pattern (any language) ------------------------

/** Reads a string field off a card's payload. */
export const payloadString = (card: Card, key: string): string | undefined => {
  const v = card.payload?.[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
