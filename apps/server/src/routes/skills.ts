import { listEquipment } from '../db/repo'
import {
  ACTIONS,
  ITEMS,
  SKILLS,
  SKILL_BY_ID,
  actionsForSkill,
  skillXpForLevel,
  type ModKind,
  type SkillDef,
  type SkillId,
} from '../game/skills'
import { SYNERGY } from '../game/talents'
import type { Bonuses } from '../game/modifiers'
import {
  actionProgressView,
  actionState,
  aggregateBonuses,
  chooseTalent,
  equipItem,
  idleView,
  inventoryView,
  settleAll,
  skillSummaries,
  talentView,
  unequipItem,
} from '../game/service'
import type { App, Deps } from '../context'

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
 *
 * Idle rigs settle here, on read (docs §13.5.1): the bank is credited for whatever
 * every running machine made since the last request, so the client always sees the
 * truth and never has to ask the server to tick.
 */
function boardSkills(deps: Deps, userId: string, now = Date.now()) {
  const db = deps.db
  const settled = settleAll(db, deps.events, userId, now)
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
        const rig = settled.rigs.get(a.id)
        return {
          ...a,
          level: ap?.level ?? 1,
          actionXp: ap?.xp ?? 0,
          intoLevel: ap?.intoLevel ?? 0,
          forNext: ap?.forNext ?? skillXpForLevel(1),
          progress: ap?.progress ?? 0,
          effect: { ...s.effect, value: currentEffect(s.effect.kind, bonuses, a.id) },
          idle: rig ? idleView(rig, a, now, bonuses.yield(a.id) + bonuses.double(a.id)) : null,
          ...actionState(db, userId, a),
        }
      }),
    }
  })
}

function bonusSummary(b: Bonuses) {
  return { globalXp: b.globalXp, damage: b.damage, drop: b.drop, hp: b.hp }
}

/**
 * Where every material is produced: itemId → the action that makes it. A recipe's
 * "needs" cost can then link to the profession that supplies it (copper ore →
 * Mining · Mine copper). When several actions make the same thing, first wins.
 */
function itemSources(): Record<string, { skillId: SkillId; actionId: string }> {
  const out: Record<string, { skillId: SkillId; actionId: string }> = {}
  for (const a of ACTIONS) {
    for (const p of a.produces ?? []) {
      if (!out[p.item]) out[p.item] = { skillId: a.skillId, actionId: a.id }
    }
  }
  return out
}

export function registerSkills(app: App) {
  // The profession board: skills (+derived level), their actions (each with its
  // own level/effect), talents and the materials bank. DESIGN §13.5.
  app.get('/api/skills', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const bonuses = aggregateBonuses(deps.db, user.id)
    return c.json({
      skills: boardSkills(deps, user.id),
      items: ITEMS,
      inventory: inventoryView(deps.db, user.id),
      equipment: listEquipment(deps.db, user.id).map((e) => ({ slot: e.slot, itemId: e.itemId })),
      bonuses: bonusSummary(bonuses),
    })
  })

  // A single profession's page: its actions (each with its own level), the talent
  // roadmap and the materials needed to label the action costs.
  app.get('/api/skills/:id', (c) => {
    const deps = c.get('deps')
    const db = deps.db
    const user = c.get('user')!
    const id = c.req.param('id') as SkillId
    if (!SKILL_BY_ID.has(id)) return c.json({ error: 'unknown profession' }, 404)
    const views = boardSkills(deps, user.id)
    const skill = views.find((s) => s.id === id)!
    // The reverse edge of the web: professions whose synergy talent feeds this
    // one. A skill can be fed by more than one trade, so this is a list; `taken`
    // tells the page whether the player actually has that talent (only then does
    // the link make sense).
    const fedBy = SKILLS.filter((s) => SYNERGY[s.id].target === id).map((s) => {
      const from = views.find((v) => v.id === s.id)
      return {
        skillId: s.id,
        name: s.name,
        label: SYNERGY[s.id].name,
        taken: from?.talent.synergy.taken ?? [],
      }
    })
    return c.json({
      skill,
      fedBy,
      items: ITEMS,
      sources: itemSources(),
      inventory: inventoryView(db, user.id),
      equipment: listEquipment(db, user.id).map((e) => ({ slot: e.slot, itemId: e.itemId })),
      bonuses: bonusSummary(aggregateBonuses(db, user.id)),
    })
  })

  // Pick one of three talents at a 10-level milestone (or change an earlier one).
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
