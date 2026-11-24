<script lang="ts">
  import type { ActivityDay } from '#lib/exercises'
  import {
    HEAT_EMPTY,
    dayLabel,
    heatCellStyle,
    heatFill,
    heatMax,
    heatWeeks,
    monthLabels,
  } from '#lib/homeview'

  interface Props {
    days: ActivityDay[]
    today?: string
    selected?: string
    onselect?: (day: string) => void
  }

  let { days, today, selected, onselect }: Props = $props()

  const weeks = $derived(heatWeeks(days.length))
  const maxXp = $derived(heatMax(days))
  const labels = $derived(monthLabels(days, weeks))
  const isFuture = (day: string) => Boolean(today && day > today)
</script>

{#if days.length}
  <div class="heat mt-2 sm:mt-3" style="--heat-weeks: {weeks}">
    <div class="heat__grid text-xs leading-none text-ink-400" aria-hidden="true">
      {#each labels as m, i (i)}
        <span
          class="min-w-0 overflow-hidden pb-0.5 whitespace-nowrap"
          style="grid-column: span {m.span}">{m.span > 1 ? m.label : ''}</span
        >
      {/each}
    </div>

    <div
      class="heat__grid heat__days mt-1"
      role="group"
      aria-label="Daily activity for the last {weeks} weeks"
    >
      {#each days as day (day.day)}
        <button
          type="button"
          class="heat__cell"
          class:cursor-pointer={!isFuture(day.day)}
          style={heatCellStyle(day, today, maxXp, selected === day.day)}
          aria-label="{dayLabel(day.day)}: {day.xp} XP, {day.reviews} {day.reviews === 1
            ? 'review'
            : 'reviews'}"
          aria-pressed={selected === day.day}
          disabled={isFuture(day.day)}
          onclick={() => onselect?.(day.day)}
        ></button>
      {/each}
    </div>

    <div class="mt-2 flex items-center justify-end gap-1.5 text-xs text-ink-400 sm:mt-3">
      <span>Less</span>
      <span class="h-3 w-3 rounded-[2px]" style="background: {HEAT_EMPTY}"></span>
      {#each [1, 2, 3, 4] as lv (lv)}
        <span class="h-3 w-3 rounded-[2px]" style="background: {heatFill(lv)}"></span>
      {/each}
      <span>More</span>
    </div>
  </div>
{:else}
  <p class="mt-3 text-xs text-ink-400">Practise to start filling this in.</p>
{/if}
