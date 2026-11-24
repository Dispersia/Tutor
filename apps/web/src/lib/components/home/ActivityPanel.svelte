<script lang="ts">
  import type { ActivityDay } from '#lib/exercises'
  import { ACCENT, accentStyle } from '#lib/theme'
  import { HEAT_WEEKS, daySummary, heatDays } from '#lib/homeview'
  import ActivityHeatmap from './ActivityHeatmap.svelte'
  import ActivityTrend from './ActivityTrend.svelte'

  interface Props {
    days: ActivityDay[]
    today?: string
    goal?: number
  }

  let { days, today, goal = 50 }: Props = $props()

  let picked = $state<string | null>(null)

  const selected = $derived(picked ?? today ?? days[days.length - 1]?.day)
  const selectedDay = $derived(days.find((d) => d.day === selected))
</script>

<section class="panel panel-accent mt-4 p-4" style={accentStyle(ACCENT.jade)}>
  <div class="flex items-baseline justify-between gap-3">
    <h2 class="eyebrow" style="color: var(--accent)">Activity</h2>
    <span class="text-xs text-ink-400">last {HEAT_WEEKS} weeks</span>
  </div>

  <ActivityHeatmap days={heatDays(days)} {today} {selected} onselect={(day) => (picked = day)} />

  <p class="mt-1 text-xs text-ink-300">
    {#if selectedDay}
      <span class="tabular-nums">{daySummary(selectedDay, today)}</span>
      {#if goal > 0 && selectedDay.xp >= goal}<span class="text-jade-300"> · goal met</span>{/if}
    {:else}
      Practise to start filling this in.
    {/if}
  </p>

  <ActivityTrend {days} {today} />
</section>
