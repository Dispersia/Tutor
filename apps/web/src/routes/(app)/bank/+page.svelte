<script lang="ts">
  import { onMount } from 'svelte'
  import { getSkills, type SkillsResponse } from '#lib/skills'
  import { itemRigs, rigGainedSince } from '#lib/idle'
  import { ACCENT, accentStyle, tierAccent } from '#lib/theme'
  import { href } from '#lib/paths'
  import Spinner from '#lib/components/Spinner.svelte'
  import { cachedAt, peekCached } from '#lib/cache'

  // Seed from the last fetch so returning to Bank shows the ledger at once.
  const cachedSkills = peekCached<SkillsResponse>('/api/skills')
  let data = $state<SkillsResponse | null>(cachedSkills ?? null)
  let error = $state('')
  let loading = $state(cachedSkills === undefined)
  /** Tick so running rigs keep counting up. */
  let fetchedAt = $state(cachedAt('/api/skills'))
  let now = $state(Date.now())

  const itemMap = $derived(new Map((data?.items ?? []).map((i) => [i.id, i])))
  const rigs = $derived(itemRigs(data?.skills ?? []))

  const GROUPS = [
    { key: 'raw', label: 'Raw' },
    { key: 'refined', label: 'Refined' },
    { key: 'consumable', label: 'Consumables' },
    { key: 'coin', label: 'Coin' },
    { key: 'other', label: 'Other' },
  ] as const

  const groups = $derived.by(() =>
    GROUPS.map((group) => ({
      ...group,
      rows: (data?.inventory ?? []).filter((row) => {
        const item = itemMap.get(row.itemId)
        return row.count > 0 && item?.tier === group.key
      }),
    })).filter((g) => g.rows.length > 0),
  )

  onMount(() => {
    void refresh()
    const timer = setInterval(() => (now = Date.now()), 250)
    return () => clearInterval(timer)
  })

  async function refresh() {
    try {
      data = await getSkills()
      fetchedAt = Date.now()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }
</script>

<div class="border-b border-ink-700 pt-4 pb-4">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h1 class="display text-3xl text-ink-100">Bank</h1>
      <p class="sub mt-2">Your materials and consumables.</p>
    </div>
    <a href={href('/inventory')} class="btn btn-ghost shrink-0 px-3 py-2 text-xs"> Inventory → </a>
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
  <section class="mt-6" style={accentStyle(ACCENT.brass)}>
    <div class="flex items-center justify-between border-b border-ink-700 pb-2">
      <h2 class="eyebrow" style="color: var(--accent)">Materials</h2>
      <span class="text-xs text-ink-400">Bank</span>
    </div>
    {#each groups as group (group.key)}
      <div class="pt-4">
        <h3 class="eyebrow" style="color: var(--accent)">{group.label}</h3>
        <div class="mt-2 flex flex-wrap gap-1.5">
          {#each group.rows as row (row.itemId)}
            {@const item = itemMap.get(row.itemId)}
            {@const rig = rigs.get(row.itemId)}
            {@const delta = rig ? (rigGainedSince(rig, fetchedAt, now)[row.itemId] ?? 0) : 0}
            <span class="chip" style={accentStyle(tierAccent(item?.tier))}>
              {item?.icon ?? ''}
              {item?.name ?? row.itemId}
              <span class="display text-gold-100 tabular-nums">×{row.count + delta}</span>
            </span>
          {/each}
        </div>
      </div>
    {/each}
    {#if groups.length === 0}
      <p class="mt-4 text-xs text-ink-400">
        Nothing here yet. Gather, craft and cook to fill your bank.
      </p>
    {/if}
  </section>

  <p class="mt-6 text-xs text-ink-400">
    Equip gear and save loadouts on the <a href={href('/inventory')} class="link">Inventory</a> screen.
  </p>
{/if}
