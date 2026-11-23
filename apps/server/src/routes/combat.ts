import type { GradeResult } from '@tutor/core'
import type { Context } from 'hono'
import {
  clearEncounter,
  getCard,
  getEncounter,
  listCards,
  listDecks,
  setPlayerHp,
  type PublicUser,
} from '../db/repo'
import { registry } from '../exercises'
import { MONSTERS, MONSTER_BY_ID, type MonsterDef } from '../game/combat'
import {
  combatLevel,
  combatResolve,
  currentHp,
  loadPlayerCombat,
  loadProgress,
  knownWords,
  monsterState,
  recordReview,
  srsStateMap,
  startEncounter,
  summary,
} from '../services'
import { readStudyPrefs } from '../services/study'
import { exerciseCtx, pickNextExercise, pickReviewCard, type SessionUser } from './practice'
import type { App, AppEnv, Deps } from '../context'
import { bool, jsonBody, str } from './body'

type PlayerCombat = ReturnType<typeof loadPlayerCombat>
type MonsterRow = NonNullable<ReturnType<typeof getEncounter>>

/** Builds "the next drill" for a monster (exercise-agnostic, review only). */
async function buildDrill(deps: Deps, user: SessionUser, deckLevel: string) {
  const deck = listDecks(deps.db, user.id).find((d) => d.level === deckLevel)
  // Combat is review only: never introduce a new card mid-fight. Prefer the
  // monster's own deck, but fall back to any reviewed card (decks like Anki
  // imports have no level, so the level match can miss).
  const card =
    pickReviewCard(deps, user.id, deck?.id) ?? (deck ? pickReviewCard(deps, user.id) : undefined)
  if (!card) return null
  const prefs = readStudyPrefs(deps.db, user.id)
  const ctx = exerciseCtx(deps, user, card, {
    known: knownWords(deps.db, user.id),
    prefs,
    distractors: 3,
  })
  const def = pickNextExercise(deps.db, user.id, card, ctx.learner, {
    ctx,
    disabled: new Set(prefs.disabledExercises),
  })
  if (!def) return null
  return { instance: await def.generate(ctx), card }
}

/** How many of the learner's cards have a review state (combat is review only). */
function countReviewCards(deps: Deps, userId: string): number {
  const srs = srsStateMap(deps.db, userId)
  return listCards(deps.db, userId).filter((c) => srs.has(c.id)).length
}

/** The live encounter as the fight board reads it (null when none is running). */
function encounterView(deps: Deps, userId: string, levels?: Map<string, number>) {
  const enc = getEncounter(deps.db, userId)
  if (!enc) return null
  const monster = MONSTER_BY_ID.get(enc.monsterId)
  const maxHp = enc.playerMaxHp || loadPlayerCombat(deps.db, userId, levels).maxHp
  return { ...encounterCore(enc, monster), playerMaxHp: maxHp }
}

/** The stored encounter's own numbers, with the monster definition as fallback. */
function encounterCore(enc: MonsterRow, monster: MonsterDef | undefined) {
  return {
    monsterId: enc.monsterId,
    monsterName: monster?.name ?? enc.monsterId,
    monsterIcon: monster?.icon ?? '👾',
    monsterHp: enc.monsterHp,
    monsterMaxHp: enc.monsterMaxHp || monster?.hp || enc.monsterHp,
    monsterDamage: enc.monsterDamage || monster?.damage || 0,
    monsterLevel: enc.monsterLevel || monster?.level || 1,
    xpReward: enc.xpReward || monster?.xp || 0,
    playerHp: enc.playerHp,
    potionId: enc.potionId,
    foodEaten: enc.foodEaten,
    totalDamage: enc.totalDamage,
  }
}

type EncounterView = ReturnType<typeof encounterView>

function playerView(deps: Deps, userId: string, player: PlayerCombat, level: number) {
  return {
    skill: player.skill,
    combatStyle: player.combatStyle,
    maxHp: player.maxHp,
    hp: currentHp(deps.db, userId, player.maxHp),
    armour: player.armour,
    weaponPower: player.weaponPower,
    power: player.power,
    stats: player.stats,
    crit: player.crit,
    haste: player.haste,
    mastery: player.mastery,
    lifesteal: player.lifesteal,
    gearScore: player.gearScore,
    setBonuses: player.setBonuses,
    level,
  }
}

function monstersView(deps: Deps, userId: string) {
  return MONSTERS.map((m: MonsterDef) => ({ ...m, ...monsterState(deps.db, userId, m) }))
}

export function registerCombat(app: App) {
  app.get('/api/combat', (c) => combatBoard(c))
  app.post('/api/combat/start', (c) => startCombat(c))
  app.post('/api/combat/leave', (c) => leaveCombat(c))
  app.post('/api/combat/hit', (c) => hitCombat(c))
}

async function combatBoard(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const progress = loadProgress(deps.db, user.id)
  const player = loadPlayerCombat(deps.db, user.id, progress.levels)
  const level = combatLevel(deps.db, user.id, progress.levels)
  // Resuming an in-progress fight needs a fresh drill too: the page only ever
  // gets one from `/start` or a `/hit`, so opening Combat mid-fight would sit
  // on "no drill available" with no way to continue.
  const view = encounterView(deps, user.id, progress.levels)
  const drill = view ? await buildDrill(deps, user, deckLevelOf(view)) : null
  return c.json({
    monsters: monstersView(deps, user.id),
    player: playerView(deps, user.id, player, level),
    reviewCount: countReviewCards(deps, user.id),
    encounter: view,
    instance: drill?.instance ?? null,
  })
}

function deckLevelOf(view: NonNullable<EncounterView>): string {
  return MONSTER_BY_ID.get(view.monsterId)?.deckLevel ?? ''
}

async function startCombat(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const monsterId = str(await jsonBody(c), 'monsterId')
  if (!monsterId) return c.json({ error: 'monsterId required' }, 400)
  if (countReviewCards(deps, user.id) === 0) {
    return c.json({ error: 'Review some cards in Practice before you fight.' }, 409)
  }
  const res = startEncounter(deps.db, deps.events, user.id, monsterId)
  if (!res.ok) {
    return c.json({ error: res.error, missing: res.missing, equipMissing: res.equipMissing }, 403)
  }
  return beginFight(c, deps, user, res)
}

/** Opens the fight: build its first review drill, or drop the encounter. */
async function beginFight(
  c: Context<AppEnv>,
  deps: Deps,
  user: PublicUser,
  res: NonNullable<ReturnType<typeof startEncounter>> & { ok: true },
) {
  const drill = await buildDrill(deps, user, res.monster.deckLevel)
  if (!drill) {
    // No review drill available — don't strand the learner in an empty fight.
    clearEncounter(deps.db, user.id)
    return c.json({ error: 'No review cards available for this fight.' }, 409)
  }
  return c.json({
    monster: res.monster,
    encounter: encounterView(deps, user.id),
    instance: drill.instance,
    drank: res.drank,
  })
}

/**
 * Flee the current fight: drop the encounter with no rewards and no penalty.
 * Without this the only exits from a fight are winning or losing, so a learner
 * who started one by accident is stuck (the monster list is hidden mid-fight).
 * Fleeing keeps the HP you have left — HP persists between fights.
 */
function leaveCombat(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const enc = getEncounter(deps.db, user.id)
  if (enc) setPlayerHp(deps.db, user.id, Math.max(1, enc.playerHp))
  clearEncounter(deps.db, user.id)
  return c.json({ encounter: null })
}

interface HitBody {
  exerciseId?: string
  cardId?: string
  answer?: unknown
  timedOut?: boolean
}

/** Reads a combat hit: the exercise, the card and the learner's answer. */
function readHit(body: Record<string, unknown>): HitBody {
  return {
    exerciseId: str(body, 'exerciseId'),
    cardId: str(body, 'cardId'),
    answer: body.answer,
    timedOut: bool(body, 'timedOut'),
  }
}

async function hitCombat(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = readHit(await jsonBody(c))
  const card = body.cardId ? getCard(deps.db, body.cardId, user.id) : undefined
  if (!card) return c.json({ error: 'card not found' }, 404)
  const def = body.exerciseId ? registry.get(body.exerciseId) : undefined
  if (!def) return c.json({ error: 'exercise not found' }, 404)
  const result = await gradeHit(deps, user, card, def, body)
  const hit = combatResolve(deps.db, deps.events, user.id, result.correct)
  if (!hit) return c.json({ error: 'no active encounter' }, 409)
  const srs = recordReview(deps.db, deps.events, user.id, {
    cardId: card.id,
    score: result.score,
    correct: result.correct,
    source: 'combat',
  })
  return finishHit(c, deps, user, { result, hit, srs })
}

interface HitSettled {
  result: GradeResult & { xp?: number }
  hit: NonNullable<ReturnType<typeof combatResolve>>
  srs: ReturnType<typeof recordReview>
}

/** The exchange's reply, including the next drill while the fight continues. */
async function finishHit(c: Context<AppEnv>, deps: Deps, user: PublicUser, settled: HitSettled) {
  const view = encounterView(deps, user.id)
  return c.json({
    ...settled,
    encounter: view,
    instance: await nextHitDrill(deps, user, settled.hit, view),
    stats: summary(deps.db, user.id),
  })
}

/** Grades the drill, short-circuiting a time-attack timeout as a miss. */
async function gradeHit(
  deps: Deps,
  user: PublicUser,
  card: NonNullable<ReturnType<typeof getCard>>,
  def: NonNullable<ReturnType<typeof registry.get>>,
  body: HitBody,
): Promise<GradeResult & { xp?: number }> {
  if (body.timedOut) {
    return { score: 0, correct: false, feedback: 'Out of time — the monster strikes.', xp: 0 }
  }
  const prefs = readStudyPrefs(deps.db, user.id)
  const ctx = exerciseCtx(deps, user, card, {
    known: knownWords(deps.db, user.id),
    prefs,
    distractors: 3,
  })
  return def.grade(ctx, await def.generate(ctx), body.answer)
}

/** The drill for the next exchange, or null once the fight has ended. */
async function nextHitDrill(
  deps: Deps,
  user: PublicUser,
  hit: NonNullable<ReturnType<typeof combatResolve>>,
  view: EncounterView,
) {
  if (hit.outcome !== 'ongoing' || !view) return null
  const monster = MONSTER_BY_ID.get(view.monsterId)
  if (!monster) return null
  return (await buildDrill(deps, user, monster.deckLevel))?.instance ?? null
}
