<script lang="ts">
  import { accentStyle } from '#lib/theme'
  import { href } from '#lib/paths'
  import { focusTrap } from '#lib/focusTrap'
  import type { Distillable } from '#lib/skillview'
  import type { DistillConfigDTO } from '#lib/skills'

  interface Props {
    accent: string
    queued: Distillable[]
    config: DistillConfigDTO
    note: string
    busy: boolean
    onDistill: (itemId: string) => void
    onToggle: (itemId: string) => void
    onMode: (mode: string) => void
  }

  let { accent, queued, config, note, busy, onDistill, onToggle, onMode }: Props = $props()

  let open = $state(false)
  const stocked = $derived(queued.filter((d) => d.count > 0).length)
</script>

<section class="panel mt-4 p-3" style={accentStyle(accent)}>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h2 class="eyebrow" style="color: var(--accent)">Distill</h2>
      <p class="mt-1 text-xs text-ink-400">
        Burn surplus stock into essence. {queued.length} item{queued.length === 1 ? '' : 's'} in the queue.
      </p>
    </div>
    <button class="btn btn-ghost shrink-0 px-2 py-1 text-xs" onclick={() => (open = true)}>
      View queue ({queued.length})
    </button>
  </div>
  <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-400">
    <label class="flex items-center gap-2">
      Burn
      <select
        class="field px-1.5 py-0.5 text-xs"
        value={config.mode}
        disabled={busy}
        onchange={(e) => onMode((e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="max-value">highest value first</option>
        <option value="min-value">lowest value first</option>
      </select>
    </label>
    <span>{stocked} with stock in the Bank.</span>
  </div>
  {#if note}
    <p class="mt-2 text-xs" style="color: var(--color-jade)">{note}</p>
  {/if}
</section>

{#if open}
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
    <button
      class="absolute inset-0"
      aria-label="Close the distill queue"
      onclick={() => (open = false)}
    ></button>
    <div
      class="panel relative z-10 max-h-[80vh] w-full max-w-lg overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Distill queue"
      tabindex="-1"
      use:focusTrap
      onkeydown={(e) => e.key === 'Escape' && (open = false)}
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="eyebrow" style="color: var(--accent)">Distill queue</h2>
          <p class="mt-1 text-xs text-ink-400">Only these items are burned by the rig.</p>
        </div>
        <button class="btn btn-ghost px-2 py-1 text-xs" onclick={() => (open = false)}>
          Close
        </button>
      </div>

      {#if queued.length === 0}
        <p class="mt-4 text-sm text-ink-300">
          Nothing queued yet. Open the <a class="link" href={href('/bank')}>Bank</a> and tap an item to
          queue it.
        </p>
      {:else}
        <ul class="mt-3 flex flex-col gap-2">
          {#each queued as d (d.itemId)}
            <li class="flex items-center justify-between gap-2 border-b border-ink-800 pb-2">
              <div class="min-w-0">
                <p class="truncate text-sm text-ink-100">
                  {d.icon}
                  {d.name}
                </p>
                <p class="text-xs text-ink-400 tabular-nums">
                  ×{d.count} in bank · {d.value} coins each
                </p>
              </div>
              <div class="flex shrink-0 gap-1">
                <button
                  class="btn btn-ghost px-2 py-0.5 text-xs"
                  disabled={busy || d.count === 0}
                  onclick={() => onDistill(d.itemId)}
                >
                  Distill
                </button>
                <button
                  class="btn btn-ghost px-2 py-0.5 text-xs"
                  disabled={busy}
                  onclick={() => onToggle(d.itemId)}
                >
                  Remove
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}
