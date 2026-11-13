import { listEquipment } from '../db/repo'
import {
  ITEMS,
  SKILLS,
  SKILL_BY_ID,
  actionsForSkill,
  type ModKind,
  type SkillDef,
  type SkillId,
} from '../game/skills'
import type { Bonuses } from '../game/modifiers'
import {
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

/** The player's current total for a skill's passive effect (levels + talents). */
function currentEffect(skill: SkillDef, b: Bonuses): number {
  const kind: ModKind = skill.effect.kind
  switch (kind) {
    case 'yield':
      return b.yield(skill.id)
    case 'double':
      return b.double(skill.id)
    case 'xp':
      return b.xp(skill.id)
    case 'coins':
      return b.coins(skill.id)
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

/** Every profession with its level, effect, talents and actions. */
function boardSkills(db: Db, userId: string) {
  const progress = new Map(skillSummaries(db, userId).map((s) => [s.skillId, s]))
  const talents = new Map(talentView(db, userId).map((t) => [t.skillId, t]))
  const bonuses = aggregateBonuses(db, userId)
  return SKILLS.map((s) => {
    const p = progress.get(s.id)!
    return {
      ...s,
      level: p.level,
      xp: p.xp,
      intoLevel: p.intoLevel,
      forNext: p.forNext,
      progress: p.progress,
      effect: { ...s.effect, value: currentEffect(s, bonuses) },
      talent: talents.get(s.id)!,
      actions: actionsForSkill(s.id).map((a) => ({ ...a, ...actionState(db, userId, a) })),
    }
  })
}

function bonusSummary(b: Bonuses) {
  return { globalXp: b.globalXp, damage: b.damage, drop: b.drop, hp: b.hp }
}

export function registerSkills(app: App) {
  // The profession board: skills (+level/xp/effect), their actions (locked /
  // affordable / equipped), talents and the materials bank. DESIGN §13.5.
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

  // A single profession's page: its actions, talent roadmap and the materials
  // needed to label the action costs.
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
