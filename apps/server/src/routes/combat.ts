import { toCardId, type UserId, type CardId } from '../ids'
import type { GradeResult } from '@tutor/core'
import type { Context } from 'hono'
import {
  clearEncounter,
  getCard,
  countScheduledCards,
  getEncounter,
  setPlayerHp,
  type PublicUser,
  type ServerCard,
} from '../db/repo'
import { registry } from '../exercises'
import { MONSTERS, MONSTER_BY_ID, type MonsterDef } from '../game/combat'
import {
  combatLevel,
  combatResolve,
  currentHp,
  DEFEAT_HP,
  loadLearnerData,
  loadPlayerCombat,
  loadProgress,
  knownWords,
  startEncounter,
  summary,
  type LoadedCards,
} from '../services'
import { readStudyPrefs, type StudyPrefs } from '../services/study'
import {
  exerciseCtx,
  pickNextExercise,
  pickReviewCard,
  readingMap,
  studyDeckId,
  type SessionUser,
} from './practice'
import { fits } from './practice/grade'
import { noteIssued, wasIssued } from './practice/issued'
import { fail, NOT_ISSUED_MESSAGE } from './errors'
import type { App, AppEnv, Deps } from '../context'
import { idField, bool, jsonBody, str } from './body'

type PlayerCombat = ReturnType<typeof loadPlayerCombat>
type MonsterRow = NonNullable<ReturnType<typeof getEncounter>>

interface DrillEnv {
  prefs: StudyPrefs
  known: Set<string>
  data: LoadedCards
}

function drillEnv(deps: Deps, userId: UserId): DrillEnv {
  const data = loadLearnerData(deps.db, userId)
  return {
    prefs: readStudyPrefs(deps.db, userId),
    known: knownWords(deps.db, userId, undefined, data),
    data,
  }
}

function drillContext(deps: Deps, user: SessionUser, card: ServerCard, env: DrillEnv) {
  return exerciseCtx(deps, user, card, {
    known: env.known,
    prefs: env.prefs,
    readings: readingMap(deps.db, user.id, card.targetLang, env.data.cards),
    distractors: 3,
  })
}

async function buildDrill(deps: Deps, user: SessionUser, env: DrillEnv) {
  const card = pickReviewCard(deps, user.id, studyDeckId(deps, user.id), env.data)
  if (!card) return null
  const ctx = drillContext(deps, user, card, env)
  const def = pickNextExercise(deps.db, user.id, card, ctx.learner, {
    ctx,
    disabled: new Set(env.prefs.disabledExercises),
  })
  if (!def) return null
  const instance = await def.generate(ctx)
  noteIssued(user.id, instance)
  return { instance, card }
}

function countReviewCards(deps: Deps, userId: UserId): number {
  return countScheduledCards(deps.db, userId)
}

function encounterView(deps: Deps, userId: UserId, levels?: Map<string, number>) {
  const enc = getEncounter(deps.db, userId)
  if (!enc) return null
  const monster = MONSTER_BY_ID.get(enc.monsterId)
  const maxHp = enc.playerMaxHp || loadPlayerCombat(deps.db, userId, levels).maxHp
  return { ...encounterCore(enc, monster), playerMaxHp: maxHp }
}

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
    xpEarned: enc.xpEarned,
  }
}

type EncounterView = ReturnType<typeof encounterView>

function playerView(deps: Deps, userId: UserId, player: PlayerCombat, level: number) {
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
  const view = encounterView(deps, user.id, progress.levels)
  const drill = view ? await buildDrill(deps, user, drillEnv(deps, user.id)) : null
  return c.json({
    monsters: MONSTERS,
    player: playerView(deps, user.id, player, level),
    reviewCount: countReviewCards(deps, user.id),
    encounter: view,
    instance: drill?.instance ?? null,
  })
}

async function startCombat(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const monsterId = str(await jsonBody(c), 'monsterId')
  if (!monsterId) return fail(c, 400, 'monsterId required')
  if (countReviewCards(deps, user.id) === 0) {
    return fail(c, 409, 'Review some cards in Practice before you fight.')
  }
  const res = startEncounter(deps.db, deps.events, user.id, monsterId)
  if (!res.ok) return fail(c, startStatus(res.error), res.error)
  return beginFight(c, deps, user, res)
}

function startStatus(error: string): 404 | 409 {
  return error === 'unknown monster' ? 404 : 409
}

async function beginFight(
  c: Context<AppEnv>,
  deps: Deps,
  user: PublicUser,
  res: NonNullable<ReturnType<typeof startEncounter>> & { ok: true },
) {
  const drill = await buildDrill(deps, user, drillEnv(deps, user.id))
  if (!drill) {
    clearEncounter(deps.db, user.id)
    return fail(c, 409, 'No review cards available for this fight.')
  }
  return c.json({
    monster: res.monster,
    encounter: encounterView(deps, user.id),
    instance: drill.instance,
    drank: res.drank,
  })
}

function leaveCombat(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const enc = getEncounter(deps.db, user.id)
  if (enc) setPlayerHp(deps.db, user.id, Math.max(DEFEAT_HP, enc.playerHp))
  clearEncounter(deps.db, user.id)
  return c.json({ encounter: null })
}

interface HitBody {
  exerciseId?: string
  cardId?: CardId
  answer?: unknown
  timedOut?: boolean
}

function readHit(body: Record<string, unknown>): HitBody {
  return {
    exerciseId: str(body, 'exerciseId'),
    cardId: idField(body, 'cardId', toCardId),
    answer: body.answer,
    timedOut: bool(body, 'timedOut'),
  }
}

async function hitCombat(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const body = readHit(await jsonBody(c))
  const card = body.cardId ? getCard(deps.db, body.cardId, user.id) : undefined
  if (!card) return fail(c, 404, 'card not found')
  const def = body.exerciseId ? registry.get(body.exerciseId) : undefined
  if (!def) return fail(c, 404, 'exercise not found')
  if (!fits(def, card, user)) return fail(c, 400, 'that exercise does not fit this card')
  if (!wasIssued(user.id, card.id, def.id)) return fail(c, 409, NOT_ISSUED_MESSAGE)
  const env = drillEnv(deps, user.id)
  const result = await gradeHit({ deps, user, card, def, body }, env)
  const hit = combatResolve(deps.db, deps.events, user.id, result.correct)
  if (!hit) return fail(c, 409, 'no active encounter')
  return finishHit(c, deps, user, { result, hit }, env)
}

interface HitSettled {
  result: GradeResult & { xp?: number }
  hit: NonNullable<ReturnType<typeof combatResolve>>
}

async function finishHit(
  c: Context<AppEnv>,
  deps: Deps,
  user: PublicUser,
  settled: HitSettled,
  env: DrillEnv,
) {
  const view = encounterView(deps, user.id)
  return c.json({
    ...settled,
    encounter: view,
    instance: await nextHitDrill(deps, user, settled.hit, view, env),
    stats: summary(deps.db, user.id),
  })
}

interface GradeHit {
  deps: Deps
  user: PublicUser
  card: NonNullable<ReturnType<typeof getCard>>
  def: NonNullable<ReturnType<typeof registry.get>>
  body: HitBody
}

async function gradeHit(hit: GradeHit, env: DrillEnv): Promise<GradeResult & { xp?: number }> {
  if (hit.body.timedOut) {
    return { score: 0, correct: false, feedback: 'Out of time — the monster strikes.', xp: 0 }
  }
  const ctx = drillContext(hit.deps, hit.user, hit.card, env)
  return hit.def.grade(ctx, await hit.def.generate(ctx), hit.body.answer)
}

async function nextHitDrill(
  deps: Deps,
  user: PublicUser,
  hit: NonNullable<ReturnType<typeof combatResolve>>,
  view: EncounterView,
  env: DrillEnv,
) {
  if (hit.outcome !== 'ongoing' || !view) return null
  return (await buildDrill(deps, user, env))?.instance ?? null
}
