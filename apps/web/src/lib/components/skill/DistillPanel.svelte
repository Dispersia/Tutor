<script lang="ts">
  import { accentStyle } from '#lib/theme'
  import type { Distillable } from '#lib/skillview'

  interface Props {
    accent: string
    distillables: Distillable[]
    note: string
    busy: boolean
    onDistill: (itemId: string) => void
  }

  let { accent, distillables, note, busy, onDistill }: Props = $props()
</script>

<section class="panel mt-4 p-3" style={accentStyle(accent)}>
  <div class="flex items-center justify-between gap-2">
    <h2 class="eyebrow" style="color: var(--accent)">Distill</h2>
    <span class="text-[11px] text-ink-400">+XP by coin value · yields essence</span>
  </div>
  {#if distillables.length === 0}
    <p class="mt-2 text-xs text-ink-400">Nothing to distill — gather or craft something first.</p>
  {:else}
    <ul class="mt-2 flex max-h-96 flex-col gap-1 overflow-auto">
      {#each distillables as d (d.itemId)}
        <li class="flex items-center justify-between gap-2 border-b border-ink-700 pb-1">
          <span class="min-w-0 truncate text-xs text-ink-200">
            {d.icon}
            {d.name}
            <span class="text-ink-500">×{d.count} · {d.value} coins</span>
          </span>
          <button
            type="button"
            class="btn btn-ghost shrink-0 px-2 py-0.5 text-[10px]"
            disabled={busy}
            onclick={() => onDistill(d.itemId)}
          >
            Distill
          </button>
        </li>
      {/each}
    </ul>
    {#if note}
      <p class="mt-2 text-xs" style="color: var(--color-jade)">{note}</p>
    {/if}
  {/if}
</section>
