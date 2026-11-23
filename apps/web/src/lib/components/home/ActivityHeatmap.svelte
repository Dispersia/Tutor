<script lang="ts">
  /** The daily-XP heat map: one column per week (Monday first), one row a weekday. */

  import type { ActivityDay } from '#lib/exercises'
  import {
    HEAT_EMPTY,
    heatCellStyle,
    heatFill,
    heatMax,
    heatWeeks,
    monthLabels,
  } from '#lib/homeview'

  interface Props {
    days: ActivityDay[]
    today?: string
  }

  let { days, today }: Props = $props()

  const weeks = $derived(heatWeeks(days.length))
  const maxXp = $derived(heatMax(days))
  const labels = $derived(monthLabels(days, weeks))
</script>

{#if days.length}
  <div class="mt-3 overflow-x-auto pb-1 xl:my-auto">
    <div class="heat mx-auto w-fit">
      <div
        class="grid gap-[3px] text-xs leading-none text-ink-400"
        style="grid-template-columns: repeat({weeks}, var(--heat-cell))"
        aria-hidden="true"
      >
        {#each labels as m, i (i)}
          <span class="whitespace-nowrap" style="grid-column: span {m.span}">{m.label}</span>
        {/each}
      </div>

      <div
        class="mt-1 grid grid-flow-col gap-[3px]"
        style="grid-template-columns: repeat({weeks}, var(--heat-cell)); grid-template-rows: repeat(7, var(--heat-cell))"
        role="img"
        aria-label="Daily activity for the last {weeks} weeks"
      >
        {#each days as d (d.day)}
          <span
            class="rounded-[2px]"
            style={heatCellStyle(d, today, maxXp)}
            title={d.xp > 0 ? `${d.xp} XP · ${d.day}` : d.day}
          ></span>
        {/each}
      </div>

      <div class="mt-3 flex items-center justify-end gap-1.5 text-xs text-ink-400">
        <span>Less</span>
        <span class="h-3 w-3 rounded-[2px]" style="background: {HEAT_EMPTY}"></span>
        {#each [1, 2, 3, 4] as lv (lv)}
          <span class="h-3 w-3 rounded-[2px]" style="background: {heatFill(lv)}"></span>
        {/each}
        <span>More</span>
      </div>
    </div>
  </div>
{:else}
  <p class="mt-3 text-xs text-ink-400 xl:my-auto">Practise to start filling this in.</p>
{/if}
