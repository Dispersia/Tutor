import type { Learner } from '@tutor/core'
import { getCard, getEncounter, listDecks, otherBacks, pickCard } from '../db/repo'
import { registry } from '../exercises'
import { MONSTERS, MONSTER_BY_ID, type MonsterDef } from '../game/combat'
import {
  combatResolve,
  getPlayerCombat,
  monsterState,
  recordReview,
  startEncounter,
  summary,
} from '../game/service'
import { pickNextExercise } from './practice'
import { seedStarterDecks } from '../seed/service'
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

/** Builds "the next drill" for a monster's deck (exercise-agnostic). */
async function buildDrill(deps: Deps, user: User, deckLevel: string) {
  seedStarterDecks(deps.db, user.id)
  const decks = listDecks(deps.db, user.id)
  const deck = decks.find((d) => d.level === deckLevel) ?? decks[0]
  const card = pickCard(deps.db, user.id, deck?.id)
  if (!card) return null
  const learner = learnerOf(user)
  const def = pickNextExercise(deps.db, user.id, card, learner)
  if (!def) return null
  const instance = await def.generate({
    card,
    learner,
    distractors: otherBacks(deps.db, user.id, card.targetLang, card.back, 3),
  })
  return { instance, card }
}

function encounterView(deps: Deps, userId: string) {
  const enc = getEncounter(deps.db, userId)
  if (!enc) return null
  const monster = MONSTER_BY_ID.get(enc.monsterId)
  const player = getPlayerCombat(deps.db, userId, monster?.combatSkill ?? 'attack')
  return {
    monsterId: enc.monsterId,
    monsterName: monster?.name ?? enc.monsterId,
    monsterIcon: monster?.icon ?? '👾',
    monsterHp: enc.monsterHp,
    monsterMaxHp: monster?.hp ?? enc.monsterHp,
    playerHp: enc.playerHp,
    playerMaxHp: enc.playerMaxHp || player.maxHp,
    potionId: enc.potionId,
    foodEaten: enc.foodEaten,
    totalDamage: enc.totalDamage,
  }
}

export function registerCombat(app: App) {
  app.get('/api/combat', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const monsters = MONSTERS.map((m: MonsterDef) => ({
      ...m,
      ...monsterState(deps.db, user.id, m),
    }))
    const view = encounterView(deps, user.id)
    const player = getPlayerCombat(
      deps.db,
      user.id,
      MONSTER_BY_ID.get(view?.monsterId ?? '')?.combatSkill ?? 'attack',
    )
    return c.json({
      monsters,
      player: { maxHp: player.maxHp, armour: player.armour, weaponPower: player.weaponPower },
      encounter: view,
    })
  })

  app.post('/api/combat/start', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { monsterId } = (await c.req.json().catch(() => ({}))) as { monsterId?: string }
    if (!monsterId) return c.json({ error: 'monsterId required' }, 400)
    const res = startEncounter(deps.db, deps.events, user.id, monsterId)
    if (!res.ok) {
      return c.json({ error: res.error, missing: res.missing, equipMissing: res.equipMissing }, 403)
    }
    const drill = await buildDrill(deps, user, res.monster.deckLevel)
    return c.json({
      monster: res.monster,
      encounter: encounterView(deps, user.id),
      instance: drill?.instance ?? null,
      drank: res.drank,
    })
  })

  app.post('/api/combat/hit', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      exerciseId?: string
      cardId?: string
      answer?: unknown
    }
    const card = body.cardId ? getCard(deps.db, body.cardId, user.id) : undefined
    if (!card) return c.json({ error: 'card not found' }, 404)
    const def = body.exerciseId ? registry.get(body.exerciseId) : undefined
    if (!def) return c.json({ error: 'exercise not found' }, 404)

    const learner = learnerOf(user)
    const ctx = {
      card,
      learner,
      distractors: otherBacks(deps.db, user.id, card.targetLang, card.back, 3),
    }
    const instance = await def.generate(ctx)
    const result = await def.grade(ctx, instance, body.answer)

    const hit = combatResolve(deps.db, deps.events, user.id, result.correct)
    if (!hit) return c.json({ error: 'no active encounter' }, 409)
    recordReview(deps.db, deps.events, user.id, card.id, result.score, result.correct)

    const view = encounterView(deps, user.id)
    let next: { instance: unknown } | null = null
    if (hit.outcome === 'ongoing') {
      const m = view ? MONSTER_BY_ID.get(view.monsterId) : undefined
      if (m) next = (await buildDrill(deps, user, m.deckLevel)) ?? null
    }

    return c.json({
      result,
      hit,
      encounter: view,
      instance: next?.instance ?? null,
      stats: summary(deps.db, user.id),
    })
  })
}
