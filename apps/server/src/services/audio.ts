import type { Card } from '@tutor/core'
import { isUtterance } from '../exercises/payload'

export function cardNeedsAudio(card: Card): boolean {
  return isUtterance(card)
}
