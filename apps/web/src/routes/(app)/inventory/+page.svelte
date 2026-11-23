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
    type GearInstanceDTO,
    type GearResponse,
  } from '#lib/skills'
  import { ACCENT, accentStyle, qualityAccent, tierAccent } from '#lib/theme'
  import { href } from '#lib/paths'
  import Spinner from '#lib/components/Spinner.svelte'
  import CraftedGearList from '#lib/components/inventory/CraftedGearList.svelte'
  import {
    SLOTS,
    STAT_LABEL,
    STAT_ORDER,
    candidatesIn,
    combatBuffsOf,
    lockedText,
    requiresText,
    statsText,
    totalsOf,
    wornOf,
  } from '#lib/inventoryview'
  import { peekCached } from '#lib/cache'

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
  const enchantCatalog = $derived(data?.enchants ?? [])
  const enchantById = $derived(new Map(enchantCatalog.map((e) => [e.id, e])))
  const enchantingLevel = $derived(data?.enchantingLevel ?? 1)

  /** Account-wide combat buffs from tier bands (§13.5.3). */
  const combatBuffs = $derived(combatBuffsOf(data?.buffs?.band))

  /** Gear instances worn in each slot. */
  const worn = $derived(wornOf(data?.equipment ?? [], new Map(gear.map((g) => [g.id, g]))))

  /** The worn totals, mirroring the server's combat maths (set bonuses included). */
  const totals = $derived(totalsOf(worn.values(), data?.setBonuses ?? []))

  const candidates = (slot: string) => candidatesIn(slot, gear)

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

  /** Apply the selected catalog enchant to a piece. */
  function enchant(g: GearInstanceDTO, enchantId: string) {
    void run(() => applyEnchant(g.id, enchantId))
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
          >+{b.stat === 'stamina' ? Math.round(b.v) : Math.round(b.v * 1000) / 10}{b.stat ===
          'stamina'
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
      <CraftedGearList
        {gear}
        {itemMap}
        {enchantCatalog}
        {enchantById}
        {enchantingLevel}
        bind:enchantPick
        onEquip={setEquip}
        onSalvage={salvage}
        onDiscard={discard}
        onEnchant={enchant}
      />

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
