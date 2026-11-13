import { listEquipment } from '../db/repo'
import { ITEMS, SKILLS, actionsForSkill, type ModKind, type SkillDef } from '../game/skills'
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

export function registerSkills(app: App) {
  // The profession board: skills (+level/xp/effect), their actions (locked /
  // affordable / equipped), talents and the materials bank. DESIGN §13.5.
  app.get('/api/skills', (c) => {
    const db = c.get('deps').db
    const user = c.get('user')!
    const progress = new Map(skillSummaries(db, user.id).map((s) => [s.skillId, s]))
    const talents = new Map(talentView(db, user.id).map((t) => [t.skillId, t]))
    const bonuses = aggregateBonuses(db, user.id)

    const skills = SKILLS.map((s) => {
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
        actions: actionsForSkill(s.id).map((a) => ({ ...a, ...actionState(db, user.id, a) })),
      }
    })

    return c.json({
      skills,
      items: ITEMS,
      inventory: inventoryView(db, user.id),
      equipment: listEquipment(db, user.id).map((e) => ({ slot: e.slot, itemId: e.itemId })),
      bonuses: {
        globalXp: bonuses.globalXp,
        damage: bonuses.damage,
        drop: bonuses.drop,
        hp: bonuses.hp,
      },
    })
  })

  // Pick one of three minor talents at the current 5-level milestone.
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
