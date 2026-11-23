import { listEquipment } from '../db/repo'
import {
  ACTIONS,
  ENCHANTS,
  ITEMS,
  SKILLS,
  SKILL_BY_ID,
  actionChoice,
  actionConsumes,
  actionOdds,
  actionsForSkill,
  itemValue,
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
  activeSetBonusesFor,
  aggregateBonuses,
  applyEnchant,
  applyGearSet,
  bandBonusesFor,
  bandView,
  chooseTalent,
  discardGearInstance,
  distillItem,
  enchantOf,
  equipItem,
  gearSetsView,
  gearView,
  idleView,
  inventoryView,
  removeGearSet,
  salvageGearInstance,
  saveGearSet,
  setRigChoice,
  settleAll,
  skillLevelOf,
  skillSummaries,
  stopRig,
  talentView,
  unequipItem,
} from '../game/service'
import { MAX_LIVE_RIGS, liveRigCount } from '../game/idle'
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
  const bands = bandView(db, userId)
  const bandById = new Map(bands.map((b) => [b.id, b]))
  const skills = SKILLS.map((s) => {
    const p = progress.get(s.id)!
    const actions = actionsForSkill(s.id)
    // The bands this profession's actions belong to (Smithing, for now): the shared
    // score a whole metal's set feeds (§13.5.3).
    const usedBands = [...new Set(actions.map((a) => a.band).filter((b): b is NonNullable<typeof b> => Boolean(b)))]
      .map((b) => bandById.get(b))
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
    return {
      ...s,
      level: p.level,
      xp: p.xp,
      progress: p.progress,
      talent: talents.get(s.id)!,
      bands: usedBands,
      actions: actions.map((a) => {
        const ap = byAction.get(a.id)
        const rig = settled.rigs.get(a.id)
        // A choose-the-recipe action's cost, odds and output follow its selection.
        const choiceId = rig?.choice || undefined
        return {
          ...a,
          level: ap?.level ?? 1,
          actionXp: ap?.xp ?? 0,
          intoLevel: ap?.intoLevel ?? 0,
          forNext: ap?.forNext ?? skillXpForLevel(1),
          progress: ap?.progress ?? 0,
          /** the currently selected recipe ('' = the action's first choice) */
          choice: choiceId ?? a.choices?.[0]?.id ?? '',
          // The selected recipe decides the cost, output and odds (§13.5.3.1).
          consumes: actionConsumes(a, choiceId),
          produces: actionChoice(a, choiceId)?.produces ?? a.produces,
          table: actionChoice(a, choiceId)?.table ?? a.table,
          success: actionOdds(a, choiceId, ap?.level ?? 1),
          effect: { ...s.effect, value: currentEffect(s.effect.kind, bonuses, a.id) },
          idle: rig ? idleView(rig, a, now, bonuses.yield(a.id) + bonuses.double(a.id)) : null,
          ...actionState(db, userId, a, choiceId),
        }
      }),
    }
  })
  // The live-rig cap readout (§13.5.1): how many machines may run at once and how
  // many are running right now, so the board can show `N / 2`.
  return { skills, rigs: { maxLive: MAX_LIVE_RIGS, live: liveRigCount(settled.rigs, now) } }
}

function bonusSummary(b: Bonuses) {
  return { globalXp: b.globalXp, damage: b.damage, drop: b.drop, hp: b.hp }
}

/** The gear screen's payload: worn rows, rolled instances and saved sets. */
function gearPayload(deps: Deps, userId: string) {
  return {
    equipment: listEquipment(deps.db, userId).map((e) => ({
      slot: e.slot,
      itemId: e.itemId,
      instanceId: e.instanceId ?? null,
    })),
    gear: gearView(deps.db, userId),
    sets: gearSetsView(deps.db, userId),
    setBonuses: activeSetBonusesFor(deps.db, userId),
    bands: bandView(deps.db, userId),
    /** the enchant catalog, grouped by slot (§13.5.3.2) */
    enchants: ENCHANTS,
    /** the player's Enchanting level, to gate enchants in the UI */
    enchantingLevel: skillLevelOf(deps.db, userId, 'enchanting'),
    /** the account-wide passive from tier bands (§13.5.3) */
    buffs: { band: bandBonusesFor(deps.db, userId) },
    items: ITEMS.map((i) => ({ ...i, value: itemValue(i) })),
    inventory: inventoryView(deps.db, userId),
  }
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
    const board = boardSkills(deps, user.id)
    return c.json({
      skills: board.skills,
      rigs: board.rigs,
      ...gearPayload(deps, user.id),
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
    const board = boardSkills(deps, user.id)
    const views = board.skills
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
      rigs: board.rigs,
      sources: itemSources(),
      ...gearPayload(deps, user.id),
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

  // Pick which recipe a choose-input action runs (prospect any ore you hold, cut any
  // rough gem of a tier). One action, one level — the choice is a parameter (§13.5.3.1).
  app.post('/api/skills/choice', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { actionId, choiceId } = (await c.req.json().catch(() => ({}))) as {
      actionId?: string
      choiceId?: string
    }
    if (!actionId || !choiceId) return c.json({ error: 'actionId and choiceId required' }, 400)
    if (!setRigChoice(deps.db, user.id, actionId, choiceId)) {
      return c.json({ error: 'unknown choice' }, 400)
    }
    const board = boardSkills(deps, user.id)
    return c.json({
      ok: true,
      skills: board.skills,
      rigs: board.rigs,
      ...gearPayload(deps, user.id),
    })
  })

  // Stop a running rig on purpose (§13.5.1): its run is paid up to now, then the
  // machine falls still so its slot frees. The UI confirms before calling this.
  app.post('/api/skills/rigs/stop', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { actionId } = (await c.req.json().catch(() => ({}))) as { actionId?: string }
    if (!actionId) return c.json({ error: 'actionId required' }, 400)
    const stopped = stopRig(deps.db, deps.events, user.id, actionId)
    const board = boardSkills(deps, user.id)
    return c.json({
      ok: stopped,
      skills: board.skills,
      rigs: board.rigs,
      ...gearPayload(deps, user.id),
    })
  })

  // The gear screen: worn rows, rolled instances and saved sets.
  app.get('/api/skills/gear', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    return c.json(gearPayload(deps, user.id))
  })

  // Equip / unequip gear. An instanceId equips that exact rolled piece; an itemId
  // equips the first free instance (or creates one from the base definition).
  app.post('/api/skills/equip', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      itemId?: string
      instanceId?: string
      slot?: string
      unequip?: boolean
    }
    if (body.unequip && body.slot) {
      unequipItem(deps.db, user.id, body.slot)
    } else {
      const instance = body.instanceId
        ? gearView(deps.db, user.id).find((g) => g.id === body.instanceId)
        : undefined
      const itemId = body.itemId ?? instance?.itemId
      if (!itemId) return c.json({ error: 'itemId or instanceId required' }, 400)
      const res = equipItem(deps.db, deps.events, user.id, itemId, instance?.id, body.slot)
      if (!res.ok) return c.json({ error: res.error, missing: res.missing }, 400)
    }
    return c.json(gearPayload(deps, user.id))
  })

  // Discard a crafted piece (must be unequipped first).
  app.post('/api/skills/gear/discard', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { instanceId } = (await c.req.json().catch(() => ({}))) as { instanceId?: string }
    if (!instanceId) return c.json({ error: 'instanceId required' }, 400)
    const res = discardGearInstance(deps.db, user.id, instanceId)
    if (!res.ok) return c.json({ error: res.error }, 400)
    return c.json(gearPayload(deps, user.id))
  })

  // Salvage a crafted piece back into crafting materials.
  app.post('/api/skills/gear/salvage', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { instanceId } = (await c.req.json().catch(() => ({}))) as { instanceId?: string }
    if (!instanceId) return c.json({ error: 'instanceId required' }, 400)
    const res = salvageGearInstance(deps.db, deps.events, user.id, instanceId)
    if (!res.ok) return c.json({ error: res.error }, 400)
    return c.json({ materials: res.materials, ...gearPayload(deps, user.id) })
  })

  // Enchant a crafted piece (§13.5.3.2): pick a catalog enchant that fits its slot,
  // spend its essence reagents. Applying grants no XP — Distill is the training.
  app.post('/api/skills/gear/enchant', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { instanceId, enchantId } = (await c.req.json().catch(() => ({}))) as {
      instanceId?: string
      enchantId?: string
    }
    if (!instanceId || !enchantId) return c.json({ error: 'instanceId and enchantId required' }, 400)
    const res = applyEnchant(deps.db, deps.events, user.id, instanceId, enchantId)
    if (!res.ok) return c.json({ error: res.error }, 400)
    return c.json(gearPayload(deps, user.id))
  })

  // Distill an item (§13.5.3.2): burn it for Enchanting XP (by its coin value) and a
  // family essence. The Enchanting page picks the item from your inventory.
  app.post('/api/skills/gear/distill', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { itemId, count } = (await c.req.json().catch(() => ({}))) as {
      itemId?: string
      count?: number
    }
    if (!itemId) return c.json({ error: 'itemId required' }, 400)
    const res = distillItem(deps.db, deps.events, user.id, itemId, count ?? 1)
    if (!res.ok) return c.json({ error: res.error }, 400)
    return c.json({ xp: res.xp, essence: res.essence, ...gearPayload(deps, user.id) })
  })

  // Save the current loadout as a named set.
  app.post('/api/skills/gear/sets', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string
      combatStyle?: 'melee' | 'ranged' | 'magic' | 'general'
    }
    const name = body.name?.trim()
    if (!name) return c.json({ error: 'name required' }, 400)
    const set = saveGearSet(deps.db, user.id, name, body.combatStyle)
    return c.json({ set, ...gearPayload(deps, user.id) })
  })

  // Swap to a saved set.
  app.post('/api/skills/gear/sets/apply', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { setId } = (await c.req.json().catch(() => ({}))) as { setId?: string }
    if (!setId) return c.json({ error: 'setId required' }, 400)
    const res = applyGearSet(deps.db, deps.events, user.id, setId)
    if (!res.ok) return c.json({ error: res.error }, 400)
    return c.json({ ...gearPayload(deps, user.id), skipped: res.skipped })
  })

  // Delete a saved set.
  app.post('/api/skills/gear/sets/delete', async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const { setId } = (await c.req.json().catch(() => ({}))) as { setId?: string }
    if (!setId) return c.json({ error: 'setId required' }, 400)
    removeGearSet(deps.db, user.id, setId)
    return c.json(gearPayload(deps, user.id))
  })
}
