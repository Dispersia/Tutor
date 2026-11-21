<script lang="ts">
  import { onMount } from 'svelte'
  import { equipItem, getSkills, unequipSlot, type SkillsResponse } from '#lib/skills'
  import { itemRigs, rigGainedSince } from '#lib/idle'
  import { ACCENT, accentStyle, tierAccent } from '#lib/theme'
  import Spinner from '#lib/components/Spinner.svelte'

  let data = $state<SkillsResponse | null>(null)
  let error = $state('')
  let loading = $state(true)
  /** When the bank was fetched — the cursor the live figures extrapolate from. */
  let fetchedAt = $state(0)
  /** Ticking clock so a running rig's count climbs in place (§13.5.1). */
  let now = $state(Date.now())

  const itemMap = $derived(new Map((data?.items ?? []).map((i) => [i.id, i])))
  const bank = $derived((data?.inventory ?? []).filter((i) => i.count > 0))
  const worn = $derived(data?.equipment ?? [])
  /** itemId → the active rig that produces it, so a count can live-advance. */
  const rigs = $derived(itemRigs(data?.skills ?? []))

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

  onMount(() => {
    void refresh()
    const timer = setInterval(() => (now = Date.now()), 250)
    return () => clearInterval(timer)
  })

  async function refresh() {
    try {
      const res = await getSkills()
      fetchedAt = Date.now()
      data = res
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

<div class="border-b border-ink-700 pt-4 pb-4">
  <div class="flex items-start justify-between gap-4">
    <h1 class="display min-w-0 text-3xl text-ink-100">Bank</h1>
    <div class="shrink-0 text-center">
      <div class="seal h-14 w-14" aria-label="{bank.length} kinds stored">
        <span class="display text-xl leading-none font-bold">{bank.length}</span>
      </div>
      <p class="seal__label" aria-hidden="true">Kinds</p>
    </div>
  </div>
  <p class="sub mt-2">The gear you wear and the goods you keep.</p>
</div>

{#if error}
  <p class="banner mt-3" style={accentStyle(ACCENT.ember)} role="alert">{error}</p>
{/if}

{#if loading}
  <p class="banner mt-4 flex items-center gap-2" style={accentStyle(ACCENT.brass)}>
    <Spinner size={14} label="Loading your bank" /> Loading…
  </p>
{:else}
  <div class="xl:grid xl:grid-cols-2 xl:items-start xl:gap-x-24">
    <!-- Equipment -->
    <section class="mt-5" style={accentStyle(ACCENT.gold)}>
      <div class="flex items-center justify-between border-b border-ink-700 pb-2">
        <h2 class="eyebrow" style="color: var(--accent)">Equipment</h2>
        <span class="text-xs text-ink-400">{worn.length} worn</span>
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
              <span class="text-ink-300">· {e.slot} ✕</span>
            </button>
          {/each}
        </div>
      </div>
    </section>

    <!-- Bank -->
    <section class="mt-6 xl:mt-5" style={accentStyle(ACCENT.brass)}>
      <div class="flex items-center justify-between border-b border-ink-700 pb-2">
        <h2 class="eyebrow" style="color: var(--accent)">Bank</h2>
        <span class="text-xs text-ink-400">{bank.length} kinds</span>
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
              <h3 class="eyebrow">{g.label}</h3>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#each g.items as b (b.itemId)}
                {@const it = itemMap.get(b.itemId)}
                {@const rig = rigs.get(b.itemId)}
                {@const delta =
                  rig && fetchedAt ? (rigGainedSince(rig, fetchedAt, now)[b.itemId] ?? 0) : 0}
                <span class="chip" style={accentStyle(tierAccent(it?.tier))}>
                  {it?.icon ?? ''}
                  {it?.name ?? b.itemId}
                  <span class="display text-gold-300 tabular-nums">×{b.count + delta}</span>
                  {#if delta > 0}
                    <span class="display tabular-nums" style="color: var(--color-jade-300)"
                      >+{delta}</span
                    >
                  {/if}
                  {#if it?.slot}
                    <button
                      onclick={() => equip(b.itemId)}
                      class="link ml-1 font-semibold"
                    >
                      equip
                    </button>
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
