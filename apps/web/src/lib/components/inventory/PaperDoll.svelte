<script lang="ts">
  import { ACCENT, accentStyle, qualityAccent } from '#lib/theme'
  import {
    SLOTS,
    lockedText,
    requiresText,
    statsText,
    wornIcon,
    wornName,
  } from '#lib/inventoryview'
  import type { GearInstanceDTO, ItemDTO } from '#lib/skills'

  interface Props {
    worn: Map<string, GearInstanceDTO>
    itemMap: Map<string, ItemDTO>
    pickedSlot: string | null
    candidates: (slot: string) => GearInstanceDTO[]
    onPick: (slot: string | null) => void
    onEquip: (slot: string, instanceId: string) => void
    onSalvage: (instanceId: string) => void
    onDiscard: (instanceId: string) => void
    onClear: (slot: string) => void
  }

  let {
    worn,
    itemMap,
    pickedSlot,
    candidates,
    onPick,
    onEquip,
    onSalvage,
    onDiscard,
    onClear,
  }: Props = $props()
</script>

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
        onclick={() => onPick(pickedSlot === slot.id ? null : slot.id)}
        aria-label="Change {slot.label}"
      >
        <span class="flex w-full items-center justify-between gap-2 text-[11px] text-ink-400">
          <span>{slot.label}</span>
          <span>{wornIcon(slot.id, worn, itemMap)}</span>
        </span>
        <span class="display truncate text-sm text-ink-100">{wornName(slot.id, worn, itemMap)}</span
        >
        {#if g}
          <span class="text-[10px] text-ink-300">{statsText(g.stats)}</span>
          {#if g.missing.length > 0}
            <span class="text-[10px]" style="color: var(--color-ember)">Needs {lockedText(g)}</span>
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
          onclick={() => onPick(null)}>Close</button
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
                  onclick={() => onEquip(pickedSlot, g.id)}
                >
                  Equip
                </button>
                <button
                  type="button"
                  class="btn btn-ghost px-2 py-1 text-[11px]"
                  onclick={() => onSalvage(g.id)}
                >
                  Salvage
                </button>
              {/if}
              <button
                type="button"
                class="btn btn-ghost px-2 py-1 text-[11px]"
                onclick={() => onDiscard(g.id)}
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
          onclick={() => onClear(pickedSlot)}
        >
          Unequip {slot?.label}
        </button>
      {/if}
    </div>
  {/if}
</section>
