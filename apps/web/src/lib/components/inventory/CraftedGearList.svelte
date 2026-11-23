<script lang="ts">
  /** The crafted-gear list: every rolled piece, its enchant picker and actions. */

  import { ACCENT, accentStyle, qualityAccent } from '#lib/theme'
  import { enchantsText, lockedText, requiresText, statsText } from '#lib/inventoryview'
  import type { EnchantDTO, GearInstanceDTO, ItemDTO } from '#lib/skills'

  interface Props {
    gear: GearInstanceDTO[]
    itemMap: Map<string, ItemDTO>
    enchantCatalog: EnchantDTO[]
    enchantById: Map<string, EnchantDTO>
    enchantingLevel: number
    enchantPick: Record<string, string>
    onEquip: (instanceId: string, slot: string) => void
    onSalvage: (instanceId: string) => void
    onDiscard: (instanceId: string) => void
    onEnchant: (g: GearInstanceDTO, enchantId: string) => void
  }

  let {
    gear,
    itemMap,
    enchantCatalog,
    enchantById,
    enchantingLevel,
    enchantPick = $bindable(),
    onEquip,
    onSalvage,
    onDiscard,
    onEnchant,
  }: Props = $props()

  const enchantsFor = (slot: string) => enchantCatalog.filter((e) => e.slot === slot)
</script>

<section class="mt-6" style={accentStyle(ACCENT.brass)}>
  <div class="flex items-center justify-between border-b border-ink-700 pb-2">
    <h2 class="eyebrow" style="color: var(--accent)">Crafted gear</h2>
    <span class="text-xs text-ink-400">{gear.length} pieces</span>
  </div>
  {#if gear.length === 0}
    <p class="mt-3 text-xs text-ink-400">
      Craft armour and weapons with Smithing, Leatherworking, Tailoring or Crafting. Every craft
      rolls its own stats.
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
          <p class="text-[10px] text-ink-500">{g.slot} · {g.quality} · score {g.gearScore}</p>
          {#if requiresText(g)}
            <p
              class="text-[10px]"
              style="color: {locked ? 'var(--color-ember)' : 'var(--color-ink-400)'}"
            >
              {locked ? `Locked — needs ${lockedText(g)}` : `Requires ${requiresText(g)}`}
            </p>
          {/if}
          {#if (g.enchant ?? []).length}
            <p class="text-[10px]" style="color: var(--color-jade)">
              ✨ {enchantsText(g, enchantById)}
            </p>
          {/if}
          {#if options.length}
            <span class="mt-1 flex flex-wrap items-center gap-1">
              <select
                class="field px-1 py-0.5 text-[10px]"
                value={sel}
                onchange={(e) => (enchantPick[g.id] = (e.currentTarget as HTMLSelectElement).value)}
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
                onclick={() => onEnchant(g, sel)}
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
              onclick={() => onEquip(g.id, g.slot)}
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
</section>
