/**
 * Branded ids (`ids.ts`): the mistakes that used to compile no longer do.
 *
 * The assertions are the `@ts-expect-error` lines: `tsc -b` checks test files,
 * so if a swapped or unbranded id ever typechecks again the directive is unused
 * and the build fails. `misuse` is never called — it only has to (not) compile.
 */

import { expect, test } from 'bun:test'
import type { Db } from './db/client'
import { getCard, getDeck, setEquipment, updateDeckSettings } from './db/repo'
import { toDeckId, toGearInstanceId, toUserId } from './ids'
import type { CardId, DeckId, GearInstanceId, UserId } from './ids'

interface Ids {
  user: UserId
  deck: DeckId
  card: CardId
  piece: GearInstanceId
}

function misuse(db: Db, ids: Ids): void {
  // The shipped bug: the user id passed where the deck id goes.
  // @ts-expect-error a UserId is not a DeckId
  updateDeckSettings(db, ids.user, { showReadings: true })
  // @ts-expect-error a UserId is not a DeckId
  getDeck(db, ids.user)
  // @ts-expect-error a plain string is not a DeckId
  getDeck(db, 'some-deck')
  // @ts-expect-error (cardId, userId) swapped
  getCard(db, ids.user, ids.card)
  // @ts-expect-error a DeckId is not a GearInstanceId
  setEquipment(db, ids.user, 'head', 'bronze_helm', ids.deck)
  // @ts-expect-error a plain string (a slot name, say) is not a GearInstanceId
  setEquipment(db, ids.user, 'head', 'bronze_helm', 'head')
  // The right way round compiles.
  updateDeckSettings(db, ids.deck, { showReadings: true })
  getCard(db, ids.card, ids.user)
  setEquipment(db, ids.user, 'head', 'bronze_helm', ids.piece)
}

test('swapped and unbranded ids are compile errors (see the @ts-expect-error lines)', () => {
  expect(typeof misuse).toBe('function')
})

test('a brand is only a type: the constructors return the same string', () => {
  const raw = 'abc'
  expect<string>(toUserId(raw)).toBe(raw)
  expect<string>(toDeckId(raw)).toBe(raw)
  expect<string>(toGearInstanceId(raw)).toBe(raw)
})
