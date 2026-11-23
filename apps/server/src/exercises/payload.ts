import type { Card } from '@tutor/core'

export function payloadTokens(card: Card): string[] {
  const t = card.payload?.tokens
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

export const hasPayloadSentence = (card: Card): boolean => payloadTokens(card).length >= 2

export const isUtterance = (card: Card): boolean =>
  card.type === 'phrase' || hasPayloadSentence(card)

export const payloadString = (card: Card, key: string): string | undefined => {
  const v = card.payload?.[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
