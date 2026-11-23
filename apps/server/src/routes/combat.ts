import type { Learner } from '@tutor/core'
import {
  clearEncounter,
  getCard,
  getEncounter,
  listCards,
  listDecks,
  otherBacks,
  setPlayerHp,
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
import { readStudyPrefs, showsReadings } from '../game/study'
import { pickNextExercise, pickReviewCard, readingMap } from './practice'
import type { App, Deps } from '../context'

type User = { id: string; nativeLang: string; targetLang: string | null; level: string | null }

function learnerOf(user: User): Learner {
  return {
    id: user.id,
    nativeLang: user.nativeLang,
    targetLang: user.targetLang ?? 'zh',
    level: user.level ?? 'hsk1',
  }
}

/** Builds "the next drill" for a monster (exercise-agnostic, review only). */
async function buildDrill(deps: Deps, user: User, deckLevel: string) {
  const decks = listDecks(deps.db, user.id)
  const deck = decks.find((d) => d.level === deckLevel)
  // Combat is review only: never introduce a new card mid-fight. Prefer the
  // monster's own deck, but fall back to any reviewed card (decks like Anki
  // imports have no level, so the level match can miss).
  const card =
    pickReviewCard(deps, user.id, deck?.id) ?? (deck ? pickReviewCard(deps, user.id) : undefined)
  if (!card) return null
  const learner = learnerOf(user)
  const prefs = readStudyPrefs(deps.db, user.id)
  const disabled = new Set(prefs.disabledExercises)
  const ctx = {
    card,
    learner,
    distractors: otherBacks(deps.db, user.id, card.targetLang, card.back, 3),
    readings: readingMap(deps.db, user.id, card.targetLang),
    known: [...knownWords(deps.db, user.id), card.back],
    showReadings: showsReadings(prefs, card.targetLang),
  }
  const def = pickNextExercise(deps.db, user.id, card, learner, ctx, { disabled })
  if (!def) return null
  const instance = await def.generate(ctx)
  return { instance, card }
}

/** How many of the learner's cards have a review state (combat is review only). */
function countReviewCards(deps: Deps, userId: string): number {
  const srs = srsStateMap(deps.db, userId)
  return listCards(deps.db, userId).filter((c) => srs.has(c.id)).length
}

function encounterView(deps: Deps, userId: string, levels?: Map<string, number>) {
  const enc = getEncounter(deps.db, userId)
  if (!enc) return null
  const monster = MONSTER_BY_ID.get(enc.monsterId)
  const player = loadPlayerCombat(deps.db, userId, levels)
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
    playerMaxHp: enc.playerMaxHp || player.maxHp,
    potionId: enc.potionId,
    foodEaten: enc.foodEaten,
    totalDamage: enc.totalDamage,
  }
}

export function registerCombat(app: App) {
  app.get('/api/combat', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const progress = loadProgress(deps.db, user.id)
    const player = loadPlayerCombat(deps.db, user.id, progress.levels)
    const level = combatLevel(deps.db, user.id, progress.levels)
    const monsters = MONSTERS.map((m: MonsterDef) => ({
      ...m,
      ...monsterState(deps.db, user.id, m),
    }))
    const view = encounterView(deps, user.id, progress.levels)
    // Resuming an in-progress fight needs a fresh drill too: the page only ever
    // gets one from `/start` or a `/hit`, so opening Combat mid-fight would sit
    // on "no drill available" with no way to continue.
    const drill = view
      ? await buildDrill(deps, user, MONSTER_BY_ID.get(view.monsterId)?.deckLevel ?? '')
      : null
    const reviewCount = countReviewCards(deps, user.id)
    return c.json({
      monsters,
      player: {
        skill: player.skill,
        combatStyle: player.combatStyle,
        maxHp: player.maxHp,
        hp: currentHp(deps.db, user.id, player.maxHp),
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
      },
      reviewCount,
      encounter: view,
      instance: drill?.instance ?? null,
    })
  })

  app.post('/api/combat/start', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { monsterId } = (await c.req.json().catch(() => ({}))) as { monsterId?: string }
    if (!monsterId) return c.json({ error: 'monsterId required' }, 400)
    if (countReviewCards(deps, user.id) === 0) {
      return c.json({ error: 'Review some cards in Practice before you fight.' }, 409)
    }
    const res = startEncounter(deps.db, deps.events, user.id, monsterId)
    if (!res.ok) {
      return c.json({ error: res.error, missing: res.missing, equipMissing: res.equipMissing }, 403)
    }
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
  })

  // Flee the current fight: drop the encounter with no rewards and no penalty.
  // Without this the only exits from a fight are winning or losing, so a learner
  // who started one by accident is stuck (the monster list is hidden mid-fight).
  app.post('/api/combat/leave', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    // Fleeing keeps the HP you have left — HP persists between fights.
    const enc = getEncounter(deps.db, user.id)
    if (enc) setPlayerHp(deps.db, user.id, Math.max(1, enc.playerHp))
    clearEncounter(deps.db, user.id)
    return c.json({ encounter: null })
  })

  app.post('/api/combat/hit', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      exerciseId?: string
      cardId?: string
      answer?: unknown
      timedOut?: boolean
    }
    const card = body.cardId ? getCard(deps.db, body.cardId, user.id) : undefined
    if (!card) return c.json({ error: 'card not found' }, 404)
    const def = body.exerciseId ? registry.get(body.exerciseId) : undefined
    if (!def) return c.json({ error: 'exercise not found' }, 404)

    const learner = learnerOf(user)
    const prefs = readStudyPrefs(deps.db, user.id)
    const ctx = {
      card,
      learner,
      distractors: otherBacks(deps.db, user.id, card.targetLang, card.back, 3),
      readings: readingMap(deps.db, user.id, card.targetLang),
      known: [...knownWords(deps.db, user.id), card.back],
      showReadings: showsReadings(prefs, card.targetLang),
    }
    // A time-attack timeout is a miss even when the drill would have accepted
    // an empty/partial answer. Skip generation: there is nothing to grade.
    const result = body.timedOut
      ? {
          score: 0,
          correct: false,
          feedback: 'Out of time — the monster strikes.',
          xp: 0,
        }
      : await def.grade(ctx, await def.generate(ctx), body.answer)

    const hit = combatResolve(deps.db, deps.events, user.id, result.correct)
    if (!hit) return c.json({ error: 'no active encounter' }, 409)
    const srs = recordReview(deps.db, deps.events, user.id, card.id, result.score, result.correct, {
      source: 'combat',
    })

    const view = encounterView(deps, user.id)
    let next: { instance: unknown } | null = null
    if (hit.outcome === 'ongoing') {
      const m = view ? MONSTER_BY_ID.get(view.monsterId) : undefined
      if (m) next = (await buildDrill(deps, user, m.deckLevel)) ?? null
    }

    return c.json({
      result,
      hit,
      srs,
      encounter: view,
      instance: next?.instance ?? null,
      stats: summary(deps.db, user.id),
    })
  })
}
