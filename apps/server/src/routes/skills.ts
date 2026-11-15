import { listEquipment } from '../db/repo'
import {
  ITEMS,
  SKILLS,
  SKILL_BY_ID,
  actionsForSkill,
  skillXpForLevel,
  type ModKind,
  type SkillDef,
  type SkillId,
} from '../game/skills'
import type { Bonuses } from '../game/modifiers'
import {
  actionProgressView,
  actionState,
  aggregateBonuses,
  chooseTalent,
  equipItem,
  inventoryView,
  skillSummaries,
  talentView,
  unequipItem,
} from '../game/service'
import type { App } from '../context'
import type { Db } from '../db/client'

/** The bonus an action carries right now (its own passive at its current level). */
function currentEffect(kind: ModKind, b: Bonuses, actionId: string): number {
  switch (kind) {
    case 'yield':
      return b.yield(actionId)
    case 'double':
      return b.double(actionId)
    case 'xp':
      return b.xp(actionId)
    case 'coins':
      return b.coins(actionId)
    case 'global_xp':
      return b.globalXp
    case 'damage':
      return b.damage
    case 'drop':
      return b.drop
    case 'hp':
      return b.hp
  }
}

/**
 * Every profession with its derived level, and each action with its own level and
 * current passive (docs/DESIGN.md §13.5). The profession has no level of its own:
 * `level` is the sum of the action levels below it.
 */
function boardSkills(db: Db, userId: string) {
  const progress = new Map(skillSummaries(db, userId).map((s) => [s.skillId, s]))
  const byAction = actionProgressView(db, userId)
  const talents = new Map(talentView(db, userId).map((t) => [t.skillId, t]))
  const bonuses = aggregateBonuses(db, userId)
  return SKILLS.map((s) => {
    const p = progress.get(s.id)!
    return {
      ...s,
      level: p.level,
      xp: p.xp,
      progress: p.progress,
      talent: talents.get(s.id)!,
      actions: actionsForSkill(s.id).map((a) => {
        const ap = byAction.get(a.id)
        return {
          ...a,
          level: ap?.level ?? 1,
          actionXp: ap?.xp ?? 0,
          intoLevel: ap?.intoLevel ?? 0,
          forNext: ap?.forNext ?? skillXpForLevel(1),
          progress: ap?.progress ?? 0,
          effect: { ...s.effect, value: currentEffect(s.effect.kind, bonuses, a.id) },
          ...actionState(db, userId, a),
        }
      }),
    }
  })
}

function bonusSummary(b: Bonuses) {
  return { globalXp: b.globalXp, damage: b.damage, drop: b.drop, hp: b.hp }
}

export function registerSkills(app: App) {
  // The profession board: skills (+derived level), their actions (each with its
  // own level/effect), talents and the materials bank. DESIGN §13.5.
  app.get('/api/skills', (c) => {
    const db = c.get('deps').db
    const user = c.get('user')!
    const bonuses = aggregateBonuses(db, user.id)
    return c.json({
      skills: boardSkills(db, user.id),
      items: ITEMS,
      inventory: inventoryView(db, user.id),
      equipment: listEquipment(db, user.id).map((e) => ({ slot: e.slot, itemId: e.itemId })),
      bonuses: bonusSummary(bonuses),
    })
  })

  // A single profession's page: its actions (each with its own level), the talent
  // roadmap and the materials needed to label the action costs.
  app.get('/api/skills/:id', (c) => {
    const db = c.get('deps').db
    const user = c.get('user')!
    const id = c.req.param('id') as SkillId
    if (!SKILL_BY_ID.has(id)) return c.json({ error: 'unknown profession' }, 404)
    const skill = boardSkills(db, user.id).find((s) => s.id === id)!
    return c.json({
      skill,
      items: ITEMS,
      inventory: inventoryView(db, user.id),
      equipment: listEquipment(db, user.id).map((e) => ({ slot: e.slot, itemId: e.itemId })),
      bonuses: bonusSummary(aggregateBonuses(db, user.id)),
    })
  })

  // Pick one of two talents at a 10-level milestone (or change an earlier one).
  app.post('/api/skills/talents', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { talentId } = (await c.req.json().catch(() => ({}))) as { talentId?: string }
    if (!talentId) return c.json({ error: 'talentId required' }, 400)
    const res = chooseTalent(deps.db, deps.events, user.id, talentId)
    if (!res.ok) return c.json({ error: res.error }, 400)
    return c.json({ ok: true, talent: res.talent, talents: talentView(deps.db, user.id) })
  })

  // Equip / unequip gear (combat actions require the right tag).
  app.post('/api/skills/equip', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      itemId?: string
      slot?: string
      unequip?: boolean
    }
    if (body.unequip && body.slot) {
      unequipItem(deps.db, user.id, body.slot)
    } else if (body.itemId) {
      const res = equipItem(deps.db, deps.events, user.id, body.itemId)
      if (!res.ok) return c.json({ error: res.error }, 400)
    } else {
      return c.json({ error: 'itemId or slot required' }, 400)
    }
    return c.json({
      equipment: listEquipment(deps.db, user.id).map((e) => ({ slot: e.slot, itemId: e.itemId })),
    })
  })
}
