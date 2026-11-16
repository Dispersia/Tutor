<script lang="ts">
  import { onMount } from 'svelte'
  import { equipItem, getSkills, unequipSlot, type SkillsResponse } from '#lib/skills'
  import { ACCENT, accentStyle, tierAccent } from '#lib/theme'
  import Spinner from '#lib/components/Spinner.svelte'

  let data = $state<SkillsResponse | null>(null)
  let error = $state('')
  let loading = $state(true)

  const itemMap = $derived(new Map((data?.items ?? []).map((i) => [i.id, i])))
  const bank = $derived((data?.inventory ?? []).filter((i) => i.count > 0))
  const worn = $derived(data?.equipment ?? [])

  // Stored goods read best by kind: raw first, then what you refined, forged
  // and brewed, so a full bank stays scannable.
  const GROUPS = [
    { key: 'raw', label: 'Raw' },
    { key: 'refined', label: 'Refined' },
    { key: 'equipment', label: 'Crafted' },
    { key: 'consumable', label: 'Consumables' },
    { key: 'coin', label: 'Coin' },
    { key: 'other', label: 'Other' },
  ] as const
  const groups = $derived.by(() =>
    GROUPS.map((g) => ({
      ...g,
      items: bank.filter((b) => (itemMap.get(b.itemId)?.tier ?? 'other') === g.key),
    })).filter((g) => g.items.length > 0),
  )

  onMount(refresh)

  async function refresh() {
    try {
      data = await getSkills()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  async function equip(itemId: string) {
    error = ''
    try {
      await equipItem(itemId)
      await refresh()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function unequip(slot: string) {
    await unequipSlot(slot).catch(() => {})
    await refresh()
  }
</script>

<div class="flex items-center justify-between border-b border-ink-700 pt-4 pb-4">
  <div>
    <h1 class="display text-3xl text-ink-100">Bank</h1>
    <p class="mt-1 text-xs text-ink-400">The gear you wear and the goods you keep.</p>
  </div>
  <div class="seal h-14 w-14 shrink-0" aria-label="{bank.length} kinds stored">
    <span class="text-2xl leading-none font-bold">{bank.length}</span>
    <span class="text-[8px] tracking-[0.16em]">KINDS</span>
  </div>
</div>

{#if error}
  <p class="mt-3 rounded-[4px] bg-ember-950 px-3 py-2 text-sm text-ember-300">{error}</p>
{/if}

{#if loading}
  <p class="mt-4 flex items-center gap-2 text-sm text-ink-400">
    <Spinner size={14} label="Loading your bank" /> Loading…
  </p>
{:else}
  <div class="xl:grid xl:grid-cols-2 xl:items-start xl:gap-x-24">
    <!-- Equipment -->
    <section class="mt-5" style={accentStyle(ACCENT.gold)}>
      <div class="flex items-center justify-between border-b border-ink-700 pb-2">
        <h2 class="text-xs font-bold tracking-widest uppercase" style="color: var(--accent)">
          Equipment
        </h2>
        <span class="text-[11px] text-ink-500">{worn.length} worn</span>
      </div>
      <div class="pt-3">
        {#if worn.length === 0}
          <p class="text-xs text-ink-400">
            Nothing equipped. Forge a weapon (Smithing) or a bow (Fletching) to train combat.
          </p>
        {/if}
        <div class="flex flex-wrap gap-2">
          {#each worn as e (e.slot)}
            {@const eq = itemMap.get(e.itemId)}
            <button
              onclick={() => unequip(e.slot)}
              class="chip"
              style={accentStyle(tierAccent(eq?.tier))}
            >
              {eq?.icon ?? ''}
              {eq?.name ?? e.itemId}
              <span class="opacity-70">· {e.slot} ✕</span>
            </button>
          {/each}
        </div>
      </div>
    </section>

    <!-- Bank -->
    <section class="mt-6 xl:mt-5" style={accentStyle(ACCENT.brass)}>
      <div class="flex items-center justify-between border-b border-ink-700 pb-2">
        <h2 class="text-xs font-bold tracking-widest uppercase" style="color: var(--accent)">
          Bank
        </h2>
        <span class="text-[11px] text-ink-500">{bank.length} kinds</span>
      </div>
      {#if bank.length === 0}
        <p class="pt-3 text-xs text-ink-400">
          Empty. Train a gathering profession to gather materials.
        </p>
      {:else}
        {#each groups as g (g.key)}
          <div class="pt-3">
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-[2px]" style="background: {tierAccent(g.key)}"></span>
              <h3 class="text-[11px] font-bold tracking-widest uppercase text-ink-400">
                {g.label}
              </h3>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#each g.items as b (b.itemId)}
                {@const it = itemMap.get(b.itemId)}
                <span class="chip" style={accentStyle(tierAccent(it?.tier))}>
                  {it?.icon ?? ''}
                  {it?.name ?? b.itemId}
                  <span class="opacity-70">×{b.count}</span>
                  {#if it?.slot}
                    <button onclick={() => equip(b.itemId)} class="ml-1 font-semibold underline"
                      >equip</button
                    >
                  {/if}
                </span>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </section>
  </div>
{/if}
