<script lang="ts">
  import {
    applyEnchant,
    applyGearSet,
    deleteGearSet,
    discardGear,
    equipInstance,
    equipItem,
    salvageGear,
    saveGearSet,
    unequipSlot,
    type GearInstanceDTO,
    type GearResponse,
  } from '#lib/skills'
  import { ACCENT, accentStyle, tierAccent } from '#lib/theme'
  import { href } from '#lib/paths'
  import Spinner from '#lib/components/Spinner.svelte'
  import CraftedGearList from '#lib/components/inventory/CraftedGearList.svelte'
  import PaperDoll from '#lib/components/inventory/PaperDoll.svelte'
  import StatChips from '#lib/components/inventory/StatChips.svelte'
  import SetBonusList from '#lib/components/inventory/SetBonusList.svelte'
  import SavedSets from '#lib/components/inventory/SavedSets.svelte'
  import {
    baseEquipmentOf,
    candidatesIn,
    combatBuffsOf,
    totalsOf,
    wornOf,
  } from '#lib/inventoryview'
  import { cachedResource } from '#lib/resource.svelte'

  // Seed from the last fetch so returning to Inventory shows the gear at once.
  const loadout = cachedResource<GearResponse>('/api/skills/gear')
  const data = $derived(loadout.data ?? null)
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
  const baseEquipment = $derived(baseEquipmentOf(data?.inventory ?? [], itemMap, gear))

  async function run(action: () => Promise<unknown>) {
    if (busy) return
    busy = true
    loadout.error = ''
    try {
      await action()
      await loadout.refresh()
    } catch (e) {
      loadout.error = (e as Error).message
    } finally {
      busy = false
    }
  }

  /** Apply the selected catalog enchant to a piece. */
  function enchant(g: GearInstanceDTO, enchantId: string) {
    void run(() => applyEnchant(g.id, enchantId))
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
      loadout.error = 'Name the set first.'
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
        loadout.error = `Some pieces are locked: ${skipped
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

{#if loadout.error}
  <p class="banner mt-3" style={accentStyle(ACCENT.ember)} role="alert">{loadout.error}</p>
{/if}

{#if loadout.loading}
  <p class="banner mt-4 flex items-center gap-2" style={accentStyle(ACCENT.brass)}>
    <Spinner size={14} label="Loading your inventory" /> Loading…
  </p>
{:else}
  <StatChips {totals} {combatBuffs} />

  <SetBonusList bonuses={data?.setBonuses ?? []} />

  <div class="xl:grid xl:grid-cols-2 xl:items-start xl:gap-x-16">
    <PaperDoll
      {worn}
      {itemMap}
      {pickedSlot}
      {candidates}
      onPick={(s) => (pickedSlot = s)}
      onEquip={setEquip}
      onSalvage={salvage}
      onDiscard={discard}
      onClear={clearSlot}
    />

    <div>
      <SavedSets
        sets={data?.sets ?? []}
        bind:name={setName}
        onSave={saveCurrentSet}
        onApply={applySet}
        onRemove={removeSet}
      />

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
