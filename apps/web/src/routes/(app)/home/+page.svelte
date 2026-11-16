<script lang="ts">
  import { onMount } from 'svelte'
  import { getStats, type ActivityDay, type Stats } from '#lib/exercises'
  import { session } from '#lib/session.svelte'
  import { ACCENT, accentStyle } from '#lib/theme'
  import { LANG_NAMES } from '#lib/voices'

  let stats = $state<Stats | null>(null)
  let error = $state('')

  const lang = $derived(session.user?.targetLang ?? 'zh')

  const LEVEL_LABELS: Record<string, string> = {
    hsk1: 'HSK 1',
    n5: 'JLPT N5',
    zhfreq: 'Frequency 1k',
  }
  const levelLabel = $derived.by(() => {
    const raw = LEVEL_LABELS[session.user?.level ?? '']
    if (lang === 'ja') return raw === 'JLPT N5' ? raw : 'JLPT N5'
    if (lang === 'zh') return raw === 'HSK 1' || raw === 'Frequency 1k' ? raw : 'HSK 1'
    return raw ?? 'Frequency 1k'
  })
  const toGoal = $derived(stats ? Math.max(0, stats.dailyGoal - stats.dailyXp) : 0)

  // --- activity map ----------------------------------------------------------
  // Daily XP over the last weeks, drawn as a heat map: one column per week
  // (Monday first), one row per weekday, the current week last. Intensity is a
  // quartile of the busiest day in the window, so the shape reads at a glance.
  const activity = $derived(stats?.activity)
  const days = $derived(activity?.days ?? [])
  const weeks = $derived(Math.floor(days.length / 7))
  const maxXp = $derived(Math.max(1, ...days.map((d) => d.xp)))

  const EMPTY = 'var(--color-ink-800)'
  const FILL = [28, 50, 72, 100]
  const fillFor = (lv: number) =>
    lv <= 0 ? EMPTY : `color-mix(in oklab, var(--accent) ${FILL[lv - 1]}%, var(--color-ink-850))`
  const levelFor = (xp: number) =>
    xp <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((xp / maxXp) * 4)))
  const cellStyle = (d: ActivityDay) =>
    activity && d.day > activity.today
      ? 'background: transparent'
      : `background: ${fillFor(levelFor(d.xp))}`

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthLabels = $derived.by(() => {
    const cols: { label: string; span: number }[] = []
    for (let w = 0; w < weeks; w++) {
      const monday = days[w * 7]?.day
      const label = monday ? (MONTHS[new Date(`${monday}T00:00:00Z`).getUTCMonth()] ?? '') : ''
      const last = cols[cols.length - 1]
      if (last && last.label === label) last.span++
      else cols.push({ label, span: 1 })
    }
    return cols
  })

  onMount(load)

  async function load() {
    error = ''
    try {
      stats = await getStats()
    } catch (e) {
      error = (e as Error).message || 'Could not load your progress.'
    }
  }
</script>

<header class="flex items-center justify-between gap-3 border-b border-ink-700 pt-4 pb-4">
  <div class="min-w-0">
    <h1 class="display truncate text-3xl text-ink-100">{session.user?.handle}</h1>
    <p class="mt-1 text-xs text-ink-400">{LANG_NAMES[lang] ?? lang} · {levelLabel}</p>
  </div>
  <div class="seal h-14 w-14 shrink-0" aria-label="Level {stats?.level ?? 1}">
    <span class="text-2xl leading-none font-bold">{stats?.level ?? 1}</span>
    <span class="text-[8px] tracking-[0.16em]">LEVEL</span>
  </div>
</header>

{#if error}
  <div class="panel mt-3 flex items-center justify-between gap-3 p-3" role="alert">
    <p class="text-xs text-brass-300">Couldn't load your progress — {error}</p>
    <button type="button" class="btn btn-ghost px-3 py-1.5 text-xs" onclick={load}>Retry</button>
  </div>
{:else}
  <section class="panel panel-accent mt-4 p-4" style={accentStyle(ACCENT.jade)}>
    <div class="flex items-baseline justify-between gap-3">
      <h2 class="text-xs font-bold tracking-widest uppercase" style="color: var(--accent)">
        Activity
      </h2>
      <span class="text-[11px] text-ink-400">last {weeks} weeks</span>
    </div>

    {#if days.length}
      <div class="mt-3 overflow-x-auto pb-1">
        <div class="mx-auto w-fit">
          <div
            class="grid gap-[3px] text-[10px] leading-none text-ink-500"
            style="grid-template-columns: repeat({weeks}, 0.75rem)"
            aria-hidden="true"
          >
            {#each monthLabels as m, i (i)}
              <span class="whitespace-nowrap" style="grid-column: span {m.span}">{m.label}</span>
            {/each}
          </div>

          <div
            class="mt-1 grid grid-flow-col gap-[3px]"
            style="grid-template-columns: repeat({weeks}, 0.75rem); grid-template-rows: repeat(7, 0.75rem)"
            role="img"
            aria-label="Daily activity for the last {weeks} weeks"
          >
            {#each days as d (d.day)}
              <span
                class="rounded-[2px]"
                style={cellStyle(d)}
                title={d.xp > 0 ? `${d.xp} XP · ${d.day}` : d.day}
              ></span>
            {/each}
          </div>

          <div class="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-ink-500">
            <span>Less</span>
            <span class="h-3 w-3 rounded-[2px]" style="background: {EMPTY}"></span>
            {#each [1, 2, 3, 4] as lv (lv)}
              <span class="h-3 w-3 rounded-[2px]" style="background: {fillFor(lv)}"></span>
            {/each}
            <span>More</span>
          </div>
        </div>
      </div>
    {:else}
      <p class="mt-3 text-xs text-ink-400">Practise to start filling this in.</p>
    {/if}
  </section>

  <section class="mt-2" aria-label="Your progress">
    <ul>
      <li class="flex items-baseline justify-between gap-3 border-b border-ink-700 px-0 py-3">
        <span class="text-sm text-ink-300">XP earned</span>
        <span class="display text-xl font-bold text-gold-200 tabular-nums"
          >{#if stats}{stats.xp}{:else}<span
              class="inline-block h-5 w-12 animate-pulse rounded bg-ink-700"
            ></span>{/if}</span
        >
      </li>
      <li class="flex items-baseline justify-between gap-3 border-b border-ink-700 px-0 py-3">
        <span class="text-sm text-ink-300">Day streak</span>
        <span class="display text-xl font-bold text-gold-200 tabular-nums"
          >{#if stats}{stats.streak}<span class="ml-1 text-xs font-normal text-ink-400"
              >{stats.streak === 1 ? 'day' : 'days'}</span
            >{:else}<span class="inline-block h-5 w-12 animate-pulse rounded bg-ink-700"></span
            >{/if}</span
        >
      </li>
      <li class="border-b border-ink-700 px-0 py-3" style={accentStyle(ACCENT.jade)}>
        <div class="flex items-baseline justify-between gap-2 text-sm">
          <span class="text-ink-300">Daily goal</span>
          <span class="text-ink-300 tabular-nums"
            >{stats ? `${stats.dailyXp} / ${stats.dailyGoal} XP` : '—'}</span
          >
        </div>
        <div
          class="bar mt-2"
          role="progressbar"
          aria-label="Daily goal"
          aria-valuemin="0"
          aria-valuemax={stats?.dailyGoal ?? 0}
          aria-valuenow={stats?.dailyXp ?? 0}
        >
          <i style="width: {stats ? Math.min(100, stats.goalPct * 100) : 0}%"></i>
        </div>
        {#if stats}
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
        {/if}
      </li>
      <li class="border-b border-ink-700 px-0 py-3" style={accentStyle(ACCENT.azure)}>
        <div class="flex items-baseline justify-between gap-2 text-sm">
          <span class="text-ink-300">Next level</span>
          <span class="text-ink-300 tabular-nums"
            >{stats ? `${stats.intoLevel} / ${stats.forNext} XP` : '—'}</span
          >
        </div>
        <div
          class="bar mt-2"
          role="progressbar"
          aria-label="Progress to level {(stats?.level ?? 1) + 1}"
          aria-valuemin="0"
          aria-valuemax={stats?.forNext ?? 0}
          aria-valuenow={stats?.intoLevel ?? 0}
        >
          <i style="width: {stats ? Math.min(100, stats.progress * 100) : 0}%"></i>
        </div>
      </li>
    </ul>
  </section>
{/if}
