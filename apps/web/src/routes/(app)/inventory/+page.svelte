<script lang="ts">
  import { onMount } from 'svelte'
  import {
    applyEnchant,
    applyGearSet,
    deleteGearSet,
    discardGear,
    equipInstance,
    equipItem,
    getGear,
    salvageGear,
    saveGearSet,
    unequipSlot,
    type BandBuffs,
    type GearInstanceDTO,
    type GearResponse,
    type GearStatId,
    type GearStats,
  } from '#lib/skills'
  import { ACCENT, accentStyle, qualityAccent, tierAccent } from '#lib/theme'
  import { href } from '#lib/paths'
  import Spinner from '#lib/components/Spinner.svelte'
  import { peekCached } from '#lib/cache'

  type SlotDef = { id: string; label: string; icon: string; family: string[] }

  /** Paper-doll order. Rings and trinkets share a family. */
  const SLOTS: SlotDef[] = [
    { id: 'head', label: 'Head', icon: '⛑️', family: ['head'] },
    { id: 'neck', label: 'Neck', icon: '📿', family: ['neck'] },
    { id: 'chest', label: 'Chest', icon: '🛡️', family: ['chest'] },
    { id: 'waist', label: 'Waist', icon: '🎗️', family: ['waist'] },
    { id: 'legs', label: 'Legs', icon: '🦿', family: ['legs'] },
    { id: 'feet', label: 'Feet', icon: '🥾', family: ['feet'] },
    { id: 'hands', label: 'Hands', icon: '🧤', family: ['hands'] },
    { id: 'ring1', label: 'Ring 1', icon: '💍', family: ['ring1', 'ring2'] },
    { id: 'ring2', label: 'Ring 2', icon: '💍', family: ['ring1', 'ring2'] },
    { id: 'trinket1', label: 'Trinket 1', icon: '🧿', family: ['trinket1', 'trinket2'] },
    { id: 'trinket2', label: 'Trinket 2', icon: '🧿', family: ['trinket1', 'trinket2'] },
    { id: 'mainHand', label: 'Main hand', icon: '🗡️', family: ['mainHand'] },
    { id: 'offHand', label: 'Off hand', icon: '🛡️', family: ['offHand'] },
  ]

  const STAT_ORDER: GearStatId[] = [
    'strength',
    'agility',
    'intellect',
    'stamina',
    'haste',
    'crit',
    'mastery',
  ]

  const STAT_LABEL: Record<GearStatId, string> = {
    strength: 'Strength',
    agility: 'Agility',
    intellect: 'Intellect',
    stamina: 'Stamina',
    haste: 'Haste',
    crit: 'Crit',
    mastery: 'Mastery',
  }

  // Seed from the last fetch so returning to Inventory shows the gear at once.
  const cachedGear = peekCached<GearResponse>('/api/skills/gear')
  let data = $state<GearResponse | null>(cachedGear ?? null)
  let error = $state('')
  let loading = $state(cachedGear === undefined)
  let busy = $state(false)
  let pickedSlot = $state<string | null>(null)
  let setName = $state('')
  /** The enchant catalog id each gear instance's control currently has selected. */
  let enchantPick = $state<Record<string, string>>({})

  const itemMap = $derived(new Map((data?.items ?? []).map((i) => [i.id, i])))
  const gear = $derived(data?.gear ?? [])
  const gearById = $derived(new Map(gear.map((g) => [g.id, g])))
  const equipped = $derived(new Map((data?.equipment ?? []).map((e) => [e.slot, e])))
  const bands = $derived(data?.bands ?? [])
  const enchantCatalog = $derived(data?.enchants ?? [])
  const enchantById = $derived(new Map(enchantCatalog.map((e) => [e.id, e])))
  const enchantingLevel = $derived(data?.enchantingLevel ?? 1)
  /** The catalog enchants that fit a piece's slot (§13.5.3.2). */
  const enchantsFor = (slot: string) => enchantCatalog.filter((e) => e.slot === slot)

  /** Account-wide combat buffs from tier bands + worn enchants (§13.5.3). */
  const combatBuffs = $derived.by(() => {
    const band = data?.buffs?.band
    const sum = (k: keyof BandBuffs) => band?.[k] ?? 0
    return (
      [
        { stat: 'crit' as const, v: sum('crit') },
        { stat: 'haste' as const, v: sum('haste') },
        { stat: 'mastery' as const, v: sum('mastery') },
        { stat: 'lifesteal' as const, v: sum('lifesteal') },
        { stat: 'stamina' as const, v: sum('stamina') },
      ] as { stat: keyof BandBuffs; v: number }[]
    ).filter((x) => x.v > 0)
  })

  /** Gear instances worn in each slot. */
  const worn = $derived.by(() => {
    const out = new Map<string, GearInstanceDTO>()
    for (const [slot, row] of equipped) {
      if (row.instanceId) {
        const g = gearById.get(row.instanceId)
        if (g) out.set(slot, g)
      }
    }
    return out
  })

  const totals = $derived.by(() => {
    const stats: GearStats = {
      strength: 0,
      agility: 0,
      intellect: 0,
      stamina: 0,
      haste: 0,
      crit: 0,
      mastery: 0,
    }
    let armour = 0
    let power = 0
    for (const g of worn.values()) {
      for (const id of STAT_ORDER) stats[id] += g.stats[id]
      armour += g.armour
      power += g.power
    }
    // Set bonuses are already part of the server's combat maths; mirror them
    // here so the inventory totals match what the fight actually uses.
    for (const set of data?.setBonuses ?? []) {
      for (const tier of set.active) {
        if (tier.stats) {
          for (const id of STAT_ORDER) stats[id] += tier.stats[id] ?? 0
        }
        if (tier.armourPct) armour *= 1 + tier.armourPct
        if (tier.powerPct) power *= 1 + tier.powerPct
      }
    }
    armour = Math.round(armour)
    power = Math.round(power)
    const score = Math.round(
      STAT_ORDER.reduce((sum, id) => sum + stats[id], 0) + armour * 2 + power * 2,
    )
    return { stats, armour, power, score }
  })

  /** Which gear instances can fill a slot (rings/trinkets share families). */
  function candidates(slot: string): GearInstanceDTO[] {
    const def = SLOTS.find((s) => s.id === slot)
    if (!def) return []
    return gear.filter((g) => def.family.includes(g.slot))
  }

  /** Equipment-tier bank items with no rolled instance (legacy crafts). */
  const baseEquipment = $derived.by(() => {
    const rolled = new Set(gear.map((g) => g.itemId))
    return (data?.inventory ?? []).filter((row) => {
      const item = itemMap.get(row.itemId)
      return row.count > 0 && item?.tier === 'equipment' && !rolled.has(row.itemId)
    })
  })

  onMount(() => {
    void refresh()
  })

  async function refresh() {
    try {
      data = await getGear()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  async function run(action: () => Promise<unknown>) {
    if (busy) return
    busy = true
    error = ''
    try {
      await action()
      await refresh()
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  function statsText(stats: GearStats): string {
    return STAT_ORDER.filter((id) => stats[id] > 0)
      .map((id) => `+${stats[id]} ${STAT_LABEL[id]}`)
      .join(' · ')
  }

  /** The skill levels a piece demands, e.g. `Attack 10 · Defence 4`. */
  function requiresText(g: GearInstanceDTO): string {
    const reqs = Object.entries(g.requirements ?? {})
    if (!reqs.length) return ''
    return reqs
      .map(([skill, level]) => `${skill.charAt(0).toUpperCase() + skill.slice(1)} ${level}`)
      .join(' · ')
  }

  /** What the player is still missing, e.g. `Attack 3/10`. */
  function lockedText(g: GearInstanceDTO): string {
    return g.missing.map((m) => `${m.name} ${m.current}/${m.level}`).join(' · ')
  }

  /** The enchant a piece carries, as `Name (+2 strength)` (§13.5.3.2). */
  function enchantsText(g: GearInstanceDTO): string {
    return (g.enchant ?? [])
      .map((id) => {
        const e = enchantById.get(id)
        return e ? `${e.name} (+${e.value} ${e.stat})` : id
      })
      .join(' · ')
  }

  /** Apply the selected catalog enchant to this piece. */
  function enchant(g: GearInstanceDTO) {
    const options = enchantsFor(g.slot)
    const id = enchantPick[g.id] ?? options[0]?.id
    if (!id) return
    void run(() => applyEnchant(g.id, id))
  }

  function wornName(slot: string): string {
    const g = worn.get(slot)
    if (!g) return 'Empty'
    return itemMap.get(g.itemId)?.name ?? g.itemId
  }

  function wornIcon(slot: string): string {
    const g = worn.get(slot)
    if (g) return itemMap.get(g.itemId)?.icon ?? '◆'
    return SLOTS.find((s) => s.id === slot)?.icon ?? '◇'
  }

  function setEquip(slot: string, instanceId: string) {
    void run(() => equipInstance(instanceId, slot))
    pickedSlot = null
  }

  function clearSlot(slot: string) {
    void run(() => unequipSlot(slot))
    pickedSlot = null
  }

  function saveCurrentSet() {
    const name = setName.trim()
    if (!name) {
      error = 'Name the set first.'
      return
    }
    void run(async () => {
      await saveGearSet(name)
      setName = ''
    })
  }

  function applySet(setId: string) {
    void run(async () => {
      const res = await applyGearSet(setId)
      const skipped = res.skipped ?? []
      if (skipped.length > 0) {
        error = `Some pieces are locked: ${skipped
          .map(
            (s) => `${s.name} (needs ${s.missing.map((m) => `${m.name} ${m.level}`).join(', ')})`,
          )
          .join('; ')}`
      }
    })
  }

  function removeSet(setId: string) {
    if (!confirm('Delete this saved set?')) return
    void run(() => deleteGearSet(setId))
  }

  function discard(instanceId: string) {
    if (!confirm('Discard this piece? This cannot be undone.')) return
    void run(() => discardGear(instanceId))
  }

  function salvage(instanceId: string) {
    if (!confirm('Salvage this piece into crafting materials?')) return
    void run(() => salvageGear(instanceId))
  }
</script>

<div class="border-b border-ink-700 pt-4 pb-4">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h1 class="display text-3xl text-ink-100">Inventory</h1>
      <p class="sub mt-2">Equip your paper doll and save loadouts for each combat style.</p>
    </div>
    <div class="shrink-0 text-center">
      <div class="seal h-14 w-14" aria-label="Gear score {totals.score}">
        <span class="display text-lg leading-none font-bold">{totals.score}</span>
      </div>
      <p class="seal__label" aria-hidden="true">Score</p>
    </div>
  </div>
</div>

{#if error}
  <p class="banner mt-3" style={accentStyle(ACCENT.ember)} role="alert">{error}</p>
{/if}

{#if loading}
  <p class="banner mt-4 flex items-center gap-2" style={accentStyle(ACCENT.brass)}>
    <Spinner size={14} label="Loading your inventory" /> Loading…
  </p>
{:else}
  <div class="mt-4 flex flex-wrap gap-1.5">
    <span class="chip" style={accentStyle(ACCENT.gold)}>⚔️ {totals.power} power</span>
    <span class="chip" style={accentStyle(ACCENT.azure)}>🛡️ {totals.armour} armour</span>
    {#each STAT_ORDER.filter((id) => totals.stats[id] > 0) as id (id)}
      <span class="chip" style={accentStyle(ACCENT.jade)}>+{totals.stats[id]} {STAT_LABEL[id]}</span
      >
    {/each}
  </div>

  {#if combatBuffs.length}
    <p class="mt-2 text-[11px] text-ink-400">
      Tier &amp; enchant bonuses
      {#each combatBuffs as b (b.stat)}
        <span style="color: var(--color-jade)"
          >+{b.stat === 'stamina' ? Math.round(b.v) : Math.round(b.v * 1000) / 10}{b.stat === 'stamina'
            ? ''
            : '%'}
          {b.stat}</span
        >
      {/each}
    </p>
  {/if}

  {#if (data?.setBonuses?.length ?? 0) > 0}
    <section class="mt-4" style={accentStyle(ACCENT.violet)}>
      <h2 class="eyebrow" style="color: var(--accent)">Set bonuses</h2>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">
        {#each data?.setBonuses ?? [] as set (set.id)}
          <div class="panel p-3" style={accentStyle(ACCENT.violet)}>
            <div class="flex items-center justify-between gap-2">
              <p class="display text-sm text-ink-100">
                {set.name}
                <span class="text-ink-400">({set.pieces})</span>
              </p>
              <span class="chip text-[10px]" style={accentStyle(ACCENT.violet)}
                >{set.armourType}</span
              >
            </div>
            {#if set.active.length > 0}
              <p class="mt-1 text-[11px] text-ink-300">
                {set.active.map((tier) => tier.label).join(' · ')}
              </p>
            {:else}
              <p class="mt-1 text-[11px] text-ink-400">No bonus yet.</p>
            {/if}
            {#if set.next}
              <p class="mt-1 text-[10px] text-ink-500">
                Next at {set.next.pieces}: {set.next.label}
              </p>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <div class="xl:grid xl:grid-cols-2 xl:items-start xl:gap-x-16">
    <!-- Paper doll -->
    <section class="mt-6" style={accentStyle(ACCENT.gold)}>
      <div class="flex items-center justify-between border-b border-ink-700 pb-2">
        <h2 class="eyebrow" style="color: var(--accent)">Equipped</h2>
        <span class="text-xs text-ink-400">{worn.size} worn</span>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {#each SLOTS as slot (slot.id)}
          {@const g = worn.get(slot.id)}
          {@const item = g ? itemMap.get(g.itemId) : undefined}
          <button
            type="button"
            class="panel panel-accent flex min-h-20 flex-col items-start gap-1 p-2 text-left"
            style={accentStyle(g ? qualityAccent(g.quality) : ACCENT.ink)}
            onclick={() => (pickedSlot = pickedSlot === slot.id ? null : slot.id)}
            aria-label="Change {slot.label}"
          >
            <span class="flex w-full items-center justify-between gap-2 text-[11px] text-ink-400">
              <span>{slot.label}</span>
              <span>{wornIcon(slot.id)}</span>
            </span>
            <span class="display truncate text-sm text-ink-100">{wornName(slot.id)}</span>
            {#if g}
              <span class="text-[10px] text-ink-300">{statsText(g.stats)}</span>
              {#if g.missing.length > 0}
                <span class="text-[10px]" style="color: var(--color-ember)"
                  >Needs {lockedText(g)}</span
                >
              {/if}
            {:else}
              <span class="text-[10px] text-ink-500">Choose a piece</span>
            {/if}
          </button>
        {/each}
      </div>

      {#if pickedSlot}
        {@const slot = SLOTS.find((s) => s.id === pickedSlot)}
        <div class="panel mt-3 p-3" style={accentStyle(ACCENT.brass)}>
          <div class="flex items-center justify-between gap-2">
            <h3 class="eyebrow" style="color: var(--accent)">Choose for {slot?.label}</h3>
            <button
              type="button"
              class="btn btn-ghost px-2 py-1 text-[11px]"
              onclick={() => (pickedSlot = null)}>Close</button
            >
          </div>
          <div class="mt-2 space-y-2">
            {#if candidates(pickedSlot).length === 0}
              <p class="text-xs text-ink-400">
                No crafted gear for this slot yet. Craft a piece with a profession.
              </p>
            {/if}
            {#each candidates(pickedSlot) as g (g.id)}
              {@const item = itemMap.get(g.itemId)}
              {@const locked = g.missing.length > 0}
              <div class="flex items-start justify-between gap-3 border-b border-ink-700 pb-2">
                <div class="min-w-0">
                  <p class="display truncate text-sm" style="color: {qualityAccent(g.quality)}">
                    {item?.icon ?? '◆'}
                    {item?.name ?? g.itemId}
                  </p>
                  <p class="text-[11px] text-ink-300">{statsText(g.stats)}</p>
                  <p class="text-[10px] text-ink-500">
                    {g.quality} · {g.armour} armour · {g.power} power · score {g.gearScore}
                  </p>
                  {#if requiresText(g)}
                    <p
                      class="text-[10px]"
                      style="color: {locked ? 'var(--color-ember)' : 'var(--color-ink-400)'}"
                    >
                      {locked ? `Locked — needs ${lockedText(g)}` : `Requires ${requiresText(g)}`}
                    </p>
                  {/if}
                </div>
                <div class="flex shrink-0 gap-1">
                  {#if g.equipped}
                    <span class="chip text-[10px]" style={accentStyle(ACCENT.jade)}>Worn</span>
                  {:else}
                    <button
                      type="button"
                      class="btn btn-primary px-2 py-1 text-[11px]"
                      disabled={locked}
                      title={locked ? `Needs ${lockedText(g)}` : 'Equip'}
                      onclick={() => setEquip(pickedSlot!, g.id)}
                    >
                      Equip
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost px-2 py-1 text-[11px]"
                      onclick={() => salvage(g.id)}
                    >
                      Salvage
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="btn btn-ghost px-2 py-1 text-[11px]"
                    onclick={() => discard(g.id)}
                  >
                    Discard
                  </button>
                </div>
              </div>
            {/each}
          </div>
          {#if worn.has(pickedSlot)}
            <button
              type="button"
              class="btn btn-ghost mt-2 px-2 py-1 text-[11px]"
              onclick={() => clearSlot(pickedSlot!)}
            >
              Unequip {slot?.label}
            </button>
          {/if}
        </div>
      {/if}
    </section>

    <div>
      <!-- Saved sets -->
      <section class="mt-6" style={accentStyle(ACCENT.violet)}>
        <div class="flex items-center justify-between border-b border-ink-700 pb-2">
          <h2 class="eyebrow" style="color: var(--accent)">Loadouts</h2>
          <span class="text-xs text-ink-400">{data?.sets.length ?? 0} saved</span>
        </div>
        <div class="mt-3 flex gap-2">
          <input
            class="field flex-1"
            placeholder="Set name (e.g. Ranged)"
            bind:value={setName}
            onkeydown={(e) => e.key === 'Enter' && saveCurrentSet()}
          />
          <button type="button" class="btn btn-primary" onclick={saveCurrentSet}>Save</button>
        </div>
        <div class="mt-3 space-y-2">
          {#if (data?.sets.length ?? 0) === 0}
            <p class="text-xs text-ink-400">
              Save the current loadout, then swap the whole outfit in one tap.
            </p>
          {/if}
          {#each data?.sets ?? [] as set (set.id)}
            <div class="flex items-center justify-between gap-3 border-b border-ink-700 pb-2">
              <div class="min-w-0">
                <p class="display truncate text-sm text-ink-100">{set.name}</p>
                <p class="text-[11px] text-ink-400">
                  {set.combatStyle} · {Object.keys(set.slots).length} slots
                </p>
              </div>
              <div class="flex shrink-0 gap-1">
                <button
                  type="button"
                  class="btn btn-primary px-2 py-1 text-[11px]"
                  onclick={() => applySet(set.id)}
                >
                  Wear
                </button>
                <button
                  type="button"
                  class="btn btn-ghost px-2 py-1 text-[11px]"
                  onclick={() => removeSet(set.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          {/each}
        </div>
      </section>

      <!-- Crafted gear -->
      <section class="mt-6" style={accentStyle(ACCENT.brass)}>
        <div class="flex items-center justify-between border-b border-ink-700 pb-2">
          <h2 class="eyebrow" style="color: var(--accent)">Crafted gear</h2>
          <span class="text-xs text-ink-400">{gear.length} pieces</span>
        </div>
        {#if gear.length === 0}
          <p class="mt-3 text-xs text-ink-400">
            Craft armour and weapons with Smithing, Leatherworking, Tailoring or Crafting. Every
            craft rolls its own stats.
          </p>
        {/if}
        <div class="mt-3 space-y-2">
          {#each gear as g (g.id)}
            {@const item = itemMap.get(g.itemId)}
            {@const locked = g.missing.length > 0}
            {@const options = enchantsFor(g.slot)}
            {@const sel = enchantPick[g.id] ?? options[0]?.id ?? ''}
            {@const def = enchantById.get(sel)}
            <div class="flex items-start justify-between gap-3 border-b border-ink-700 pb-2">
              <div class="min-w-0">
                <p class="display truncate text-sm" style="color: {qualityAccent(g.quality)}">
                  {item?.icon ?? '◆'}
                  {item?.name ?? g.itemId}
                </p>
                <p class="text-[11px] text-ink-300">{statsText(g.stats)}</p>
                <p class="text-[10px] text-ink-500">
                  {g.slot} · {g.quality} · score {g.gearScore}
                </p>
                {#if requiresText(g)}
                  <p
                    class="text-[10px]"
                    style="color: {locked ? 'var(--color-ember)' : 'var(--color-ink-400)'}"
                  >
                    {locked ? `Locked — needs ${lockedText(g)}` : `Requires ${requiresText(g)}`}
                  </p>
                {/if}
                {#if (g.enchant ?? []).length}
                  <p class="text-[10px]" style="color: var(--color-jade)">✨ {enchantsText(g)}</p>
                {/if}
                {#if options.length}
                  <span class="mt-1 flex flex-wrap items-center gap-1">
                    <select
                      class="field px-1 py-0.5 text-[10px]"
                      value={sel}
                      onchange={(e) =>
                        (enchantPick[g.id] = (e.currentTarget as HTMLSelectElement).value)}
                      aria-label="Enchant"
                    >
                      {#each options as e (e.id)}
                        <option value={e.id} disabled={enchantingLevel < e.level}
                          >{e.name} · +{e.value} {e.stat} · Lv {e.level}</option
                        >
                      {/each}
                    </select>
                    <button
                      type="button"
                      class="btn btn-ghost px-2 py-0.5 text-[10px]"
                      disabled={!def || enchantingLevel < def.level}
                      onclick={() => enchant(g)}
                    >
                      Enchant
                    </button>
                    {#if def}
                      <span class="text-[10px] text-ink-500">
                        {def.reagents
                          .map((r) => `${r.count}× ${itemMap.get(r.item)?.name ?? r.item}`)
                          .join(', ')}
                      </span>
                    {/if}
                  </span>
                {/if}
              </div>
              <div class="flex shrink-0 gap-1">
                {#if g.equipped}
                  <span class="chip text-[10px]" style={accentStyle(ACCENT.jade)}>Worn</span>
                {:else}
                  <button
                    type="button"
                    class="btn btn-primary px-2 py-1 text-[11px]"
                    disabled={locked}
                    title={locked ? `Needs ${lockedText(g)}` : 'Equip'}
                    onclick={() => setEquip(g.slot, g.id)}
                  >
                    Equip
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost px-2 py-1 text-[11px]"
                    onclick={() => salvage(g.id)}
                  >
                    Salvage
                  </button>
                {/if}
                <button
                  type="button"
                  class="btn btn-ghost px-2 py-1 text-[11px]"
                  onclick={() => discard(g.id)}
                >
                  Discard
                </button>
              </div>
            </div>
          {/each}
        </div>
      </section>

      <!-- Unrolled equipment -->
      {#if baseEquipment.length > 0}
        <section class="mt-6" style={accentStyle(ACCENT.ink)}>
          <h3 class="eyebrow">Unrolled equipment</h3>
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#each baseEquipment as row (row.itemId)}
              {@const item = itemMap.get(row.itemId)}
              <button
                type="button"
                class="chip"
                style={accentStyle(tierAccent(item?.tier))}
                onclick={() => run(() => equipItem(row.itemId))}
              >
                {item?.icon ?? ''}
                {item?.name ?? row.itemId} ×{row.count}
              </button>
            {/each}
          </div>
        </section>
      {/if}

      <p class="mt-6 text-xs text-ink-400">
        Materials and consumables live in the <a href={href('/bank')} class="link">Bank</a>.
      </p>
    </div>
  </div>
{/if}
