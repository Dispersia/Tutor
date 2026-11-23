declare const brand: unique symbol
type Brand<K extends string> = string & { readonly [brand]: K }

export type UserId = Brand<'UserId'>
export type DeckId = Brand<'DeckId'>
export type CardId = Brand<'CardId'>
export type SessionId = Brand<'SessionId'>
export type GearInstanceId = Brand<'GearInstanceId'>
export type GearSetId = Brand<'GearSetId'>

export const toUserId = (s: string): UserId => s as UserId
export const toDeckId = (s: string): DeckId => s as DeckId
export const toCardId = (s: string): CardId => s as CardId
export const toSessionId = (s: string): SessionId => s as SessionId
export const toGearInstanceId = (s: string): GearInstanceId => s as GearInstanceId
export const toGearSetId = (s: string): GearSetId => s as GearSetId
