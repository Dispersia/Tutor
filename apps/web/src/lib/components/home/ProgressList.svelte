<script lang="ts">
  import type { Stats } from '#lib/exercises'
  import { ACCENT, accentStyle } from '#lib/theme'

  interface Props {
    stats: Stats
    toGoal: number
  }

  let { stats, toGoal }: Props = $props()
</script>

<section class="panel mt-4 px-4" aria-label="Your progress">
  <ul class="[&>li:last-child]:border-b-0">
    <li class="border-b border-ink-700 px-0 py-3">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-sm text-ink-300">Study XP</span>
        <span class="display text-xl font-bold text-gold-200 tabular-nums">{stats.xp}</span>
      </div>
      <p class="mt-1 text-xs text-ink-400">
        From graded cards and won fights — this fills your daily goal, not your account level.
      </p>
    </li>
    <li class="flex items-baseline justify-between gap-3 border-b border-ink-700 px-0 py-3">
      <span class="text-sm text-ink-300">Day streak</span>
      <span class="display text-xl font-bold text-gold-200 tabular-nums"
        >{stats.streak}<span class="ml-1 text-xs font-normal text-ink-400"
          >{stats.streak === 1 ? 'day' : 'days'}</span
        ></span
      >
    </li>
    <li class="border-b border-ink-700 px-0 py-3" style={accentStyle(ACCENT.jade)}>
      <div class="flex items-baseline justify-between gap-2 text-sm">
        <span class="text-ink-300">Daily goal</span>
        <span class="text-ink-300 tabular-nums">{`${stats.dailyXp} / ${stats.dailyGoal} XP`}</span>
      </div>
      <div
        class="bar mt-2"
        role="progressbar"
        aria-label="Daily goal"
        aria-valuemin="0"
        aria-valuemax={stats.dailyGoal}
        aria-valuenow={stats.dailyXp}
      >
        <i style="width: {Math.min(100, stats.goalPct * 100)}%"></i>
      </div>
      <p
        class="mt-2 text-xs {stats.goalPct >= 1
          ? 'text-jade-300'
          : stats.todayActive
            ? 'text-ink-400'
            : 'text-brass-300'}"
      >
        {#if stats.goalPct >= 1}
          Goal reached — nice work today.
        {:else if stats.todayActive}
          {toGoal} XP to your daily goal.
        {:else}
          Practise today to keep your streak alive.
        {/if}
      </p>
    </li>
    <li class="border-b border-ink-700 px-0 py-3" style={accentStyle(ACCENT.azure)}>
      <div class="flex items-baseline justify-between gap-2 text-sm">
        <span class="text-ink-300">Account level</span>
        <span class="text-ink-300 tabular-nums">{`${stats.level} / 100`}</span>
      </div>
      <div
        class="bar mt-2"
        role="progressbar"
        aria-label="Account level {stats.level} of 100 — the average of every profession"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(stats.progress * 100)}
      >
        <i style="width: {Math.min(100, stats.progress * 100)}%"></i>
      </div>
      <p class="mt-2 text-xs text-ink-400">
        The average of every profession, so it climbs as each one levels.
      </p>
    </li>
  </ul>
</section>
