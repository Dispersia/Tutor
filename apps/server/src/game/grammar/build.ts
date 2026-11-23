/**
 * The n+1 sentence builder engine (docs/DESIGN.md §13.7).
 *
 * Given the *new* word of the current step and the set of words the learner
 * already knows, this finds a short Mandarin sentence that uses the new word
 * exactly once and nothing else the learner has not met. That is the whole point
 * of the path: every card is "known words + exactly one new thing".
 *
 * It is deliberately a small hand-written pattern grammar, not an LLM call, so
 * it is instant, deterministic and works with no API key. The patterns and their
 * semantic tables live in `patterns.data.ts`.
 */

import { FREQUENCY, LEXICON, type FreqWord, type Pos } from '../../text/lexicon'
import {
  OBJECT_VERBS,
  PATTERNS,
  VERB_OBJECTS,
  nounClass,
  type Pattern,
  type Slot,
} from './patterns.data'

/** Positions of speech for which sentence_build can ever apply. */
export const SENTENCE_POS: ReadonlySet<Pos> = new Set<Pos>([
  'pron',
  'noun',
  'vt',
  'vi',
  'vadj',
  'adv',
  'aux',
  'part',
  'conj',
  'prep',
])

export interface SentenceBuild {
  /** the correct order, one token per word */
  tokens: string[]
  /** shuffled tiles: the tokens plus a few distractors */
  bank: string[]
  /** English prompt for the sentence */
  gloss: string
  /** pinyin of the whole sentence */
  reading: string
  /** the new word that this sentence introduces */
  target: string
}

/** The in-flight state while one pattern's slots are filled in order. */
interface FillCtx {
  target: FreqWord
  targetRole?: string
  knows: Set<string>
  used: Set<string>
  values: Record<string, FreqWord>
  rand: () => number
}

/**
 * Tries to place the new word into one pattern, filling every other part with
 * words the learner already knows. Returns the first match, or `undefined`.
 */
export function buildSentence(
  target: FreqWord,
  known: Set<string>,
  rand: () => number = Math.random,
): SentenceBuild | undefined {
  const knows = new Set(known)
  knows.add(target.word)
  for (const pattern of PATTERNS) {
    const build = tryPattern(pattern, target, knows, rand)
    if (build) return build
  }
  return undefined
}

/** Cheap feature check without building a full sentence (used for availability). */
export function canBuildSentence(target: FreqWord, known: Set<string>): boolean {
  return buildSentence(target, known, () => 0) !== undefined
}

function tryPattern(
  pattern: Pattern,
  target: FreqWord,
  knows: Set<string>,
  rand: () => number,
): SentenceBuild | undefined {
  const feature = featureRolesOf(pattern, target)
  if (!feature || !literalWordsKnown(pattern, target, knows)) return undefined
  const roles = feature.lit ? [undefined, ...feature.roles] : feature.roles
  for (const targetRole of roles) {
    const values: Record<string, FreqWord> = {}
    const ctx: FillCtx = { target, targetRole, knows, used: new Set([target.word]), values, rand }
    if (fillParts(pattern, ctx)) return finalize(pattern, values, target, rand)
  }
  return undefined
}

/** Which roles the new word could fill here, and whether it is a literal feature. */
function featureRolesOf(
  pattern: Pattern,
  target: FreqWord,
): { roles: string[]; lit: boolean } | undefined {
  const roles = (pattern.featureRoles ?? [])
    .filter((f) => f.pos.includes(target.pos))
    .map((f) => f.role)
  const lit = pattern.featureLiterals?.includes(target.word) ?? false
  if (roles.length === 0 && !lit) return undefined
  return { roles, lit }
}

/** Every literal word in the pattern must already be known. */
function literalWordsKnown(pattern: Pattern, target: FreqWord, knows: Set<string>): boolean {
  return pattern.parts.every((p) => typeof p !== 'string' || knows.has(p) || p === target.word)
}

/** Fills every slot of the pattern; false when a slot cannot be satisfied. */
function fillParts(pattern: Pattern, ctx: FillCtx): boolean {
  for (const part of pattern.parts) {
    if (typeof part === 'string') continue
    if (!placePart(part, ctx)) return false
  }
  return true
}

function placePart(part: Slot, ctx: FillCtx): boolean {
  if (part.role === ctx.targetRole) return placeTarget(part, ctx)
  const pool = candidatesFor(part, ctx.target, ctx.knows, ctx.used, ctx.values)
  if (pool.length === 0) return false
  const pick = pool[Math.floor(ctx.rand() * pool.length) % pool.length]!
  ctx.values[part.role] = pick
  ctx.used.add(pick.word)
  return true
}

/** Places the new word itself, checking its slot and object compatibility. */
function placeTarget(part: Slot, ctx: FillCtx): boolean {
  if (!matchesSlot(ctx.target, part)) return false
  // object compatibility (the verb is already filled: patterns put it first)
  if (part.objectOf) {
    const allowed = VERB_OBJECTS[ctx.values[part.objectOf]?.word ?? '']
    if (!allowed || !allowed.includes(ctx.target.word)) return false
  }
  ctx.values[part.role] = ctx.target
  return true
}

function matchesSlot(w: FreqWord, slot: Slot): boolean {
  if (!slot.pos.includes(w.pos)) return false
  if (slot.only && !slot.only.includes(w.word)) return false
  if (slot.exclude?.includes(w.word)) return false
  if (slot.objectVerb && !OBJECT_VERBS.has(w.word)) return false
  if (slot.nounClass && nounClass(w.word) !== slot.nounClass) return false
  return true
}

function candidatesFor(
  slot: Slot,
  target: FreqWord,
  known: Set<string>,
  used: Set<string>,
  values: Record<string, FreqWord>,
): FreqWord[] {
  let pool = FREQUENCY.filter(
    (w) => matchesSlot(w, slot) && known.has(w.word) && !used.has(w.word) && w.word !== target.word,
  )
  if (slot.objectOf) {
    const allowed = VERB_OBJECTS[values[slot.objectOf]?.word ?? '']
    pool = allowed ? pool.filter((w) => allowed.includes(w.word)) : []
  }
  if (slot.prefer) {
    const preferred = pool.filter((w) => slot.prefer!.includes(w.word))
    if (preferred.length) return preferred
  }
  return pool
}

/** Turns a fully-filled pattern into the sentence, or nothing when too short. */
function finalize(
  pattern: Pattern,
  values: Record<string, FreqWord>,
  target: FreqWord,
  rand: () => number,
): SentenceBuild | undefined {
  const tokens = pattern.parts
    .map((p) => (typeof p === 'string' ? p : values[p.role]!.word))
    .filter(Boolean)
  if (tokens.length < 2) return undefined
  return {
    tokens,
    bank: shuffle([...tokens, ...pickDistractors(target, tokens, rand)], rand),
    gloss: sentenceGloss(pattern.english(values)),
    reading: tokens.map((t) => LEXICON.get(t)?.pinyin ?? t).join(' '),
    target: target.word,
  }
}

function sentenceGloss(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1) + (/[.?!]$/.test(s) ? '' : '.')
}

function pickDistractors(target: FreqWord, tokens: string[], rand: () => number): string[] {
  const inSentence = new Set(tokens)
  const tokenPos = new Set(tokens.map((t) => LEXICON.get(t)?.pos).filter(Boolean) as Pos[])
  const pool = FREQUENCY.filter(
    (w) => !inSentence.has(w.word) && w.word !== target.word && tokenPos.has(w.pos),
  )
  const fallback = FREQUENCY.filter((w) => !inSentence.has(w.word) && w.word !== target.word)
  const source = pool.length >= 2 ? pool : fallback
  const picks: string[] = []
  const seen = new Set(inSentence)
  for (let i = 0; i < source.length * 2 && picks.length < 3; i++) {
    const w = source[Math.floor(rand() * source.length) % source.length]!
    if (seen.has(w.word)) continue
    seen.add(w.word)
    picks.push(w.word)
  }
  return picks
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}
