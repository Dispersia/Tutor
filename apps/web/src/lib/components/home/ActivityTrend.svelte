<script lang="ts">
  import type { ActivityDay } from '#lib/exercises'
  import { trendBuckets, trendGeometry, type TrendGrain } from '#lib/homeview'

  interface Props {
    days: ActivityDay[]
    today?: string
  }

  const GRAINS: { id: TrendGrain; label: string; noun: string }[] = [
    { id: 'day', label: 'Day', noun: 'day' },
    { id: 'week', label: 'Week', noun: 'week' },
    { id: 'month', label: 'Month', noun: 'month' },
  ]

  let { days, today }: Props = $props()

  let grain = $state<TrendGrain>('week')
  let hover = $state<number | null>(null)

  const noun = $derived(GRAINS.find((g) => g.id === grain)?.noun ?? 'week')
  const buckets = $derived(trendBuckets(days, grain, today))
  const geometry = $derived(trendGeometry(buckets.map((b) => b.value)))
  const shown = $derived(buckets[hover ?? buckets.length - 1])
  const marker = $derived(geometry.dots[hover ?? buckets.length - 1])
  const peak = $derived(Math.max(0, ...buckets.map((b) => b.value)))
</script>

<div class="mt-3 border-t border-ink-700 pt-2 sm:mt-4 sm:pt-3">
  <div class="flex items-center justify-between gap-2">
    <p class="eyebrow">XP per {noun}</p>
    <div class="seg" role="group" aria-label="Trend range">
      {#each GRAINS as g (g.id)}
        <button
          type="button"
          class="seg__btn"
          aria-pressed={grain === g.id}
          onclick={() => {
            grain = g.id
            hover = null
          }}>{g.label}</button
        >
      {/each}
    </div>
  </div>

  {#if buckets.length}
    <div class="relative mt-3 h-20 sm:h-28">
      <svg
        class="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={geometry.area} fill="color-mix(in oklab, var(--accent) 16%, transparent)" />
        <path
          d={geometry.line}
          fill="none"
          stroke="var(--accent)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <div class="absolute inset-0 flex">
        {#each buckets as b, i (b.key)}
          <button
            type="button"
            class="h-full w-0 min-w-0 flex-1 cursor-pointer"
            aria-label="{b.title}: {b.value} XP"
            onmouseenter={() => (hover = i)}
            onmouseleave={() => (hover = null)}
            onfocus={() => (hover = i)}
            onblur={() => (hover = null)}
          ></button>
        {/each}
      </div>

      {#if marker}
        <span
          class="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style="left: {marker.x}%; top: {marker.y}%; background: var(--accent)"
        ></span>
      {/if}
    </div>

    <div class="mt-1 flex justify-between text-[0.68rem] text-ink-500">
      <span>{buckets[0]!.axis}</span>
      {#if buckets.length > 2}<span>{buckets[Math.floor(buckets.length / 2)]!.axis}</span>{/if}
      {#if buckets.length > 1}<span>{buckets[buckets.length - 1]!.axis}</span>{/if}
    </div>

    <p class="mt-1 text-xs text-ink-300">
      {#if shown}
        {shown.title} · <span class="tabular-nums text-ink-100">{shown.value} XP</span>
      {/if}
      <span class="text-ink-500">· best {peak} XP</span>
    </p>
  {:else}
    <p class="mt-3 text-xs text-ink-400">Practise to start filling this in.</p>
  {/if}
</div>
