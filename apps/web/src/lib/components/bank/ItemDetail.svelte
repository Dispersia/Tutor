<script lang="ts">
  import { accentStyle, tierAccent } from '#lib/theme'
  import { href } from '#lib/paths'
  import type { ItemDetailDTO, ItemDTO } from '#lib/skills'
  import Spinner from '#lib/components/Spinner.svelte'

  interface Props {
    item: ItemDTO
    count: number
    detail: ItemDetailDTO | null
    loading: boolean
    error: string
    queued: boolean
    busy: boolean
    onToggle: () => void
    onClose: () => void
  }

  let { item, count, detail, loading, error, queued, busy, onToggle, onClose }: Props = $props()

  const view = $derived(detail?.item ?? item)
  const essence = $derived(detail?.essence ?? null)
  const usedIn = $derived(detail?.usedIn ?? [])
  const sources = $derived(detail?.sources ?? [])
  const distillable = $derived(view.tier !== 'coin')

  function chance(chance: number): string {
    return `${Math.round(chance * 100)}%`
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div
  class="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-2 sm:items-center sm:p-4"
>
  <button class="absolute inset-0" aria-label="Close item details" onclick={onClose}></button>
  <div
    class="panel relative z-10 max-h-[90vh] w-full max-w-xl overflow-y-auto p-4 sm:p-5"
    role="dialog"
    aria-modal="true"
    aria-label={view.name}
  >
    <header class="flex items-start justify-between gap-3 border-b border-ink-800 pb-3">
      <div class="flex min-w-0 items-start gap-3">
        <span class="text-3xl" aria-hidden="true">{view.icon}</span>
        <div class="min-w-0">
          <h2 class="display truncate text-xl text-ink-100">{view.name}</h2>
          <p class="mt-0.5 text-xs text-ink-400">
            <span style={accentStyle(tierAccent(view.tier))}>{view.tier}</span>
            · {count} in bank
          </p>
        </div>
      </div>
      <button class="btn btn-ghost shrink-0 px-2 py-1 text-xs" onclick={onClose}>Close</button>
    </header>

    <p class="mt-3 text-sm text-ink-200">{view.description}</p>

    <div class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      <div class="rounded border border-ink-800 p-2">
        <p class="eyebrow text-ink-500">Worth</p>
        <p class="mt-1 text-ink-100">{view.value ?? 0} coins each</p>
      </div>
      {#if distillable && essence}
        <div class="rounded border border-ink-800 p-2">
          <p class="eyebrow text-ink-500">Distills into</p>
          <p class="mt-1 text-ink-100">{essence.icon} {essence.name}</p>
        </div>
      {/if}
    </div>

    {#if loading}
      <p class="mt-4 flex items-center gap-2 text-sm text-ink-400">
        <Spinner size={14} /> Loading recipes and sources…
      </p>
    {:else if error}
      <p class="mt-4 text-sm text-red-400">{error}</p>
    {:else}
      <section class="mt-4">
        <h3 class="eyebrow text-ink-500">Used in</h3>
        {#if usedIn.length === 0}
          <p class="mt-1 text-sm text-ink-400">
            {view.tier === 'equipment'
              ? 'Equip it in combat or salvage it for materials.'
              : 'No recipe uses this item yet.'}
          </p>
        {:else}
          <ul class="mt-1 flex flex-col gap-1">
            {#each usedIn as use (use.kind + use.actionId + use.name)}
              <li class="text-sm">
                {#if use.kind === 'enchant'}
                  <span class="text-ink-200">{use.skillName} · {use.name}</span>
                {:else}
                  <a class="link" href={href(`/skills/${use.skillId}#action-${use.actionId}`)}>
                    {use.skillName} · {use.name}
                  </a>
                {/if}
                <span class="text-xs text-ink-400">needs {use.count}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="mt-4">
        <h3 class="eyebrow text-ink-500">How to acquire</h3>
        {#if sources.length === 0}
          <p class="mt-1 text-sm text-ink-400">No known source.</p>
        {:else}
          <ul class="mt-1 flex flex-col gap-1">
            {#each sources as source (source.kind + source.name + (source.monsterId ?? ''))}
              <li class="text-sm">
                {#if source.kind === 'action'}
                  <a
                    class="link"
                    href={href(`/skills/${source.skillId}#action-${source.actionId}`)}
                  >
                    {source.skillName} · {source.name}
                  </a>
                {:else}
                  <span>{source.icon} {source.name}</span>
                  <span class="text-xs text-ink-400">drops ({chance(source.chance ?? 0)})</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    {#if distillable}
      <div class="mt-4 flex items-center justify-between gap-3 border-t border-ink-800 pt-3">
        <p class="text-xs text-ink-400">
          {queued ? 'This item is in the Distill queue.' : 'Queue this item for the Distill rig.'}
        </p>
        <button
          class="btn {queued ? 'btn-ghost' : 'btn-gold'} px-2 py-1 text-xs"
          disabled={busy}
          onclick={onToggle}
        >
          {queued ? 'Remove from queue' : 'Queue for Distill'}
        </button>
      </div>
    {/if}
  </div>
</div>
