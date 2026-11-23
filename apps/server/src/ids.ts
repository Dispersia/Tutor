/**
 * Branded ids (docs/ARCHITECTURE.md). Every id is a string at runtime, so a
 * user id passed where a deck id is wanted used to compile; two shipped bugs
 * were exactly that. A brand is a compile-time tag: `UserId` and `DeckId` are
 * both strings, yet neither is assignable to the other, nor is a bare `string`.
 *
 * Ids are branded where they enter the server: the drizzle columns carry the
 * type (`.$type<UserId>()` in `db/schema`), so every row is branded for free,
 * and the constructors below tag what arrives over HTTP or is newly generated.
 * They are plain casts: nothing here exists at runtime beyond an identity call.
 * Game-content ids (skills, items, actions, slots) are catalogue keys and stay
 * as they are.
 */

declare const brand: unique symbol
type Brand<K extends string> = string & { readonly [brand]: K }

export type UserId = Brand<'UserId'>
export type DeckId = Brand<'DeckId'>
export type CardId = Brand<'CardId'>
/** A chat session (`sessions`), not a login session. */
export type SessionId = Brand<'SessionId'>
export type GearInstanceId = Brand<'GearInstanceId'>
export type GearSetId = Brand<'GearSetId'>

export const toUserId = (s: string): UserId => s as UserId
export const toDeckId = (s: string): DeckId => s as DeckId
export const toCardId = (s: string): CardId => s as CardId
export const toSessionId = (s: string): SessionId => s as SessionId
export const toGearInstanceId = (s: string): GearInstanceId => s as GearInstanceId
export const toGearSetId = (s: string): GearSetId => s as GearSetId
