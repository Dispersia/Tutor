<script lang="ts">
  import { accentStyle } from '#lib/theme'
  import { focusTrap } from '#lib/focusTrap'
  import { itemIcon as itemIconOf, itemName as itemNameOf } from '#lib/components/combat/itemName'
  import type { EnchantDTO, EquippedDTO, GearInstanceDTO, GearSetDTO, ItemDTO } from '#lib/skills'

  interface Props {
    accent: string
    enchants: EnchantDTO[]
    level: number
    gear: GearInstanceDTO[]
    sets: GearSetDTO[]
    equipment: EquippedDTO[]
    itemMap: Map<string, ItemDTO>
    owned: Map<string, number>
    busy: boolean
    onEnchant: (instanceId: string, enchantId: string) => void
  }

  let { accent, enchants, level, gear, sets, equipment, itemMap, owned, busy, onEnchant }: Props =
    $props()

  const SLOT_FAMILY: Record<string, string[]> = {
    ring1: ['ring1', 'ring2'],
    ring2: ['ring1', 'ring2'],
    trinket1: ['trinket1', 'trinket2'],
    trinket2: ['trinket1', 'trinket2'],
  }

  const SLOT_LABEL: Record<string, string> = {
    head: 'Head',
    neck: 'Neck',
    chest: 'Chest',
    waist: 'Waist',
    legs: 'Legs',
    feet: 'Feet',
    hands: 'Hands',
    mainHand: 'Main hand',
    offHand: 'Off hand',
    ring1: 'Rings',
    trinket1: 'Trinkets',
  }

  let open = $state<EnchantDTO | null>(null)
  let error = $state('')

  const bySlot = $derived.by(() => {
    const order: string[] = []
    const groups: Record<string, EnchantDTO[]> = {}
    for (const e of enchants) {
      if (!groups[e.slot]) {
        groups[e.slot] = []
        order.push(e.slot)
      }
      groups[e.slot]!.push(e)
    }
    return order.map((slot) => ({
      slot,
      label: SLOT_LABEL[slot] ?? slot,
      list: [...groups[slot]!].sort((a, b) => a.level - b.level),
    }))
  })

  const unlocked = $derived(enchants.filter((e) => e.level <= level).length)

  function ownedCount(item: string): number {
    return owned.get(item) ?? 0
  }

  function affordable(e: EnchantDTO): boolean {
    return e.reagents.every((r) => ownedCount(r.item) >= r.count)
  }

  const itemName = (id: string) => itemNameOf(itemMap, id)
  const itemIcon = (id: string) => itemIconOf(itemMap, id)

  function candidateIds(e: EnchantDTO): string[] {
    const family = SLOT_FAMILY[e.slot] ?? [e.slot]
    const ids: string[] = []
    const add = (id: string) => {
      if (!ids.includes(id)) ids.push(id)
    }
    for (const set of sets) {
      for (const slot of family) {
        const entry = set.slots[slot]
        if (entry?.instanceId) add(entry.instanceId)
      }
    }
    for (const eq of equipment) {
      if (family.includes(eq.slot) && eq.instanceId) add(eq.instanceId)
    }
    return ids
  }

  function candidatesFor(e: EnchantDTO): GearInstanceDTO[] {
    const family = SLOT_FAMILY[e.slot] ?? [e.slot]
    const saved = candidateIds(e)
      .map((id) => gear.find((g) => g.id === id))
      .filter((g): g is GearInstanceDTO => Boolean(g))
    return saved.length > 0 ? saved : gear.filter((g) => family.includes(g.slot))
  }

  function sourcesFor(g: GearInstanceDTO): string {
    const out: string[] = []
    if (g.equipped) out.push('worn')
    for (const set of sets) {
      for (const slot of Object.keys(set.slots)) {
        if (set.slots[slot]?.instanceId === g.id) {
          out.push(set.name)
          break
        }
      }
    }
    return out.length ? out.join(', ') : 'bank'
  }

  function pick(instanceId: string) {
    if (!open) return
    error = ''
    onEnchant(instanceId, open.id)
    open = null
  }

  function attempt(e: EnchantDTO) {
    if (e.level > level) {
      error = `${e.name} needs Enchanting ${e.level}.`
      return
    }
    if (!affordable(e)) {
      error = `${e.name} needs ${e.reagents
        .filter((r) => ownedCount(r.item) < r.count)
        .map((r) => `${r.count}× ${itemName(r.item)}`)
        .join(', ')}.`
      return
    }
    error = ''
    open = e
  }
</script>

<section class="panel mt-4 p-3" style={accentStyle(accent)}>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h2 class="eyebrow" style="color: var(--accent)">Enchants</h2>
      <p class="mt-1 text-xs text-ink-400">
        Distill to raise Enchanting and unlock recipes. Each one spends ore and a combat reagent on
        a piece you already wear.
      </p>
    </div>
    <span class="shrink-0 text-xs text-ink-400">{unlocked} / {enchants.length} unlocked</span>
  </div>

  {#if error}
    <p class="mt-2 text-xs" style="color: var(--color-ember)">{error}</p>
  {/if}

  <div class="mt-3 grid max-h-[26rem] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
    {#each bySlot as group (group.slot)}
      <div>
        <p class="eyebrow text-[10px] text-ink-400">{group.label}</p>
        <ul class="mt-1 flex flex-col gap-1">
          {#each group.list as e (e.id)}
            {@const locked = e.level > level}
            {@const canPay = affordable(e)}
            <li class="flex items-center justify-between gap-2 border-b border-ink-800 pb-1">
              <div class="min-w-0">
                <p
                  class="truncate text-xs"
                  style="color: {locked ? 'var(--color-ink-500)' : 'var(--color-ink-100)'}"
                >
                  {e.name} · +{e.value}
                  {e.stat}
                </p>
                <p class="text-[10px] text-ink-500">
                  Lv {e.level} ·
                  {#each e.reagents as r, i (r.item)}
                    {#if i > 0},
                    {/if}
                    <span
                      style="color: {ownedCount(r.item) >= r.count
                        ? 'var(--color-ink-400)'
                        : 'var(--color-ember)'}">{r.count}× {itemName(r.item)}</span
                    >
                  {/each}
                </p>
              </div>
              <button
                type="button"
                class="btn btn-ghost shrink-0 px-2 py-0.5 text-[10px]"
                disabled={busy || locked || !canPay}
                title={locked
                  ? `Needs Enchanting ${e.level}`
                  : canPay
                    ? 'Choose a piece to enchant'
                    : 'Missing reagents'}
                onclick={() => attempt(e)}
              >
                Enchant
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
</section>

{#if open}
  {@const candidates = candidatesFor(open)}
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
    <button
      class="absolute inset-0"
      aria-label="Close the enchant picker"
      onclick={() => (open = null)}
    ></button>
    <div
      class="panel relative z-10 max-h-[80vh] w-full max-w-lg overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a piece to enchant"
      tabindex="-1"
      use:focusTrap
      onkeydown={(e) => e.key === 'Escape' && (open = null)}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="eyebrow" style="color: var(--accent)">{open.name}</h2>
          <p class="mt-1 text-xs text-ink-400">
            +{open.value}
            {open.stat} · {SLOT_LABEL[open.slot] ?? open.slot}
          </p>
        </div>
        <button class="btn btn-ghost px-2 py-1 text-xs" onclick={() => (open = null)}>Close</button>
      </div>

      {#if candidates.length === 0}
        <p class="mt-4 text-sm text-ink-300">
          No {SLOT_LABEL[open.slot] ?? open.slot} piece to enchant yet. Craft or equip one, then save
          a loadout so it shows up here.
        </p>
      {:else}
        <p class="mt-3 text-[11px] text-ink-500">
          Pieces from your loadouts and what you have on, newest first.
        </p>
        <ul class="mt-2 flex flex-col gap-2">
          {#each candidates as g (g.id)}
            <li class="flex items-center justify-between gap-2 border-b border-ink-800 pb-2">
              <div class="min-w-0">
                <p class="truncate text-sm text-ink-100">
                  {itemIcon(g.itemId) || '◆'}
                  {itemName(g.itemId)}
                </p>
                <p class="text-[11px] text-ink-400">
                  {g.quality} · {g.slot} · {sourcesFor(g)}
                  {#if g.enchant.length}· ✨ {g.enchant.length} enchant{/if}
                </p>
              </div>
              <button
                type="button"
                class="btn btn-primary shrink-0 px-2 py-0.5 text-xs"
                disabled={busy}
                onclick={() => pick(g.id)}
              >
                Enchant
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}
