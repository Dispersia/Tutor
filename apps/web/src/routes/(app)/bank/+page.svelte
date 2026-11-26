<script lang="ts">
  import { onMount } from 'svelte'
  import { useSkills } from '#lib/skills/store.svelte'
  import { getItem, toggleDistill, type ItemDetailDTO, type ItemDTO } from '#lib/skills'
  import { itemRigs, rigGainedSince } from '#lib/idle'
  import { ACCENT, accentStyle, tierAccent } from '#lib/theme'
  import { href } from '#lib/paths'
  import Spinner from '#lib/components/Spinner.svelte'
  import ItemDetail from '#lib/components/bank/ItemDetail.svelte'

  const board = useSkills()
  const itemMap = $derived(board.itemMap)
  const rigs = $derived(itemRigs(board.skills))
  const allowed = $derived(new Set(board.distill.allow))
  let busy = $state(false)
  let selected = $state<ItemDTO | null>(null)
  let selectedCount = $state(0)
  let detail = $state<ItemDetailDTO | null>(null)
  let detailLoading = $state(false)
  let detailError = $state('')
  let queueError = $state('')

  const GROUPS = [
    { key: 'raw', label: 'Raw' },
    { key: 'refined', label: 'Refined' },
    { key: 'equipment', label: 'Equipment' },
    { key: 'consumable', label: 'Consumables' },
    { key: 'coin', label: 'Coin' },
    { key: 'other', label: 'Other' },
  ] as const

  async function markDistill(itemId: string) {
    busy = true
    queueError = ''
    try {
      const next = await toggleDistill(itemId)
      board.patch({ distill: next.distill })
    } catch (e) {
      queueError = e instanceof Error ? e.message : 'Could not update the distill queue.'
    } finally {
      busy = false
    }
  }

  async function openItem(item: ItemDTO, count: number) {
    selected = item
    selectedCount = count
    detail = null
    detailError = ''
    queueError = ''
    detailLoading = true
    try {
      detail = await getItem(item.id)
    } catch (e) {
      detailError = e instanceof Error ? e.message : 'Could not load this item.'
    } finally {
      detailLoading = false
    }
  }

  function closeItem() {
    selected = null
    detail = null
    detailError = ''
    queueError = ''
  }

  const groups = $derived.by(() =>
    GROUPS.map((group) => ({
      ...group,
      rows: board.inventory.filter((row) => {
        const item = itemMap.get(row.itemId)
        return row.count > 0 && item?.tier === group.key
      }),
    })).filter((group) => group.rows.length > 0),
  )

  onMount(() => {
    void board.refresh()
  })
</script>

<div class="border-b border-ink-700 pt-5 pb-4">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="display text-3xl">Bank</h1>
      <p class="sub mt-2">
        Your materials, gear and consumables. Tap an item for its details and to queue it for
        Distill.
      </p>
    </div>
    <a href={href('/inventory')} class="btn btn-ghost shrink-0 px-2 py-1 text-xs"> Inventory → </a>
  </div>
</div>

{#if board.error}
  <p class="banner mt-4" style={accentStyle(ACCENT.ember)} role="alert">{board.error}</p>
{/if}

{#if board.loading}
  <p class="banner mt-4 flex items-center gap-2" style={accentStyle(ACCENT.brass)}>
    <Spinner size={16} /> Loading your bank…
  </p>
{:else}
  <section class="mt-4" style={accentStyle(ACCENT.brass)}>
    <div class="flex items-center justify-between border-b border-ink-700 pb-2">
      <h2 class="eyebrow" style="color: var(--accent)">Materials</h2>
      <span class="text-xs text-ink-400">Tap an item for details</span>
    </div>
    {#each groups as group (group.key)}
      <div class="mt-4">
        <h3 class="eyebrow" style="color: var(--accent)">{group.label}</h3>
        <div class="mt-2 flex flex-wrap gap-2">
          {#each group.rows as row (row.itemId)}
            {@const item = itemMap.get(row.itemId)}
            {@const rig = rigs.get(row.itemId)}
            {@const delta = rig ? rigGainedSince(rig, board.fetchedAt, board.now)[row.itemId] : 0}
            {@const queued = allowed.has(row.itemId)}
            <button
              class="chip"
              class:chip--on={queued}
              style={accentStyle(queued ? ACCENT.ember : tierAccent(item?.tier))}
              title={queued ? 'Queued for Distill — tap for details' : 'Tap for details'}
              onclick={() => item && openItem(item, row.count + delta)}
            >
              {item?.icon ?? ''}
              {item?.name ?? row.itemId}
              <span class="tabular-nums">×{row.count + delta}</span>
              {#if queued}
                <span aria-hidden="true">🔥</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {/each}
    {#if groups.length === 0}
      <p class="mt-4 text-sm text-ink-300">
        Nothing here yet. Gather, craft and fight to fill your bank.
      </p>
    {/if}
  </section>

  <p class="mt-6 text-xs text-ink-400">
    Equip gear and save loadouts on the <a href={href('/inventory')} class="link">Inventory</a> screen.
  </p>
{/if}

{#if selected}
  <ItemDetail
    item={selected}
    count={selectedCount}
    {detail}
    loading={detailLoading}
    error={detailError}
    {queueError}
    queued={allowed.has(selected.id)}
    {busy}
    onToggle={() => selected && markDistill(selected.id)}
    onClose={closeItem}
  />
{/if}
