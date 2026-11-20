<script lang="ts">
  import { onMount } from 'svelte'
  import { getStats, type ActivityDay, type Stats } from '#lib/exercises'
  import { getSkills, type SkillsResponse } from '#lib/skills'
  import { fmtClock, fmtInterval, rigGainedSince, rigSecondsLeft } from '#lib/idle'
  import { href } from '#lib/paths'
  import { session } from '#lib/session.svelte'
  import { activeDeckOf, loadActiveDeck } from '#lib/activeDeck.svelte'
  import { ACCENT, CATEGORY, accentStyle, type CategoryStyle } from '#lib/theme'
  import { LANG_NAMES } from '#lib/voices'

  let stats = $state<Stats | null>(null)
  let error = $state('')
  /** The idle panel is optional: Home works even if the board fails to load. */
  let skills = $state<SkillsResponse | null>(null)
  /** When the board was fetched — the cursor the live counters extrapolate from. */
  let fetchedAt = $state(0)
  /** Ticking clock so a rig's counter climbs in place (§13.5.1). */
  let now = $state(Date.now())

  const lang = $derived(session.user?.targetLang ?? 'zh')
  /** The deck the member studies everywhere, shown beside the language. */
  const deckName = $derived(activeDeckOf()?.name)

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

  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
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

  // --- idle rigs (docs/DESIGN.md §13.5.1) ------------------------------------
  // The board settles on the server; here we only extrapolate between fetches so
  // the home panel shows what is accumulating right now.
  const itemMap = $derived(new Map((skills?.items ?? []).map((i) => [i.id, i])))
  const rigs = $derived.by(() => {
    const out: {
      actionId: string
      skillId: string
      actionName: string
      icon: string
      category: CategoryStyle
      left: number
      runPct: number
      made: number
      rate: string
      xpPerCraft: number
      yields: string
    }[] = []
    for (const s of skills?.skills ?? []) {
      for (const a of s.actions) {
        if (!a.idle?.active) continue
        const left = rigSecondsLeft(a.idle, now)
        const made = fetchedAt
          ? Object.values(rigGainedSince(a.idle, fetchedAt, now)).reduce((n, v) => n + v, 0)
          : 0
        out.push({
          actionId: a.id,
          skillId: s.id,
          actionName: a.name,
          icon: s.icon,
          category: CATEGORY[s.category],
          left,
          runPct: Math.min(1, Math.max(0, left / a.idle.runSec)),
          made,
          rate: fmtInterval(a.idle.intervalSec),
          xpPerCraft: a.idle.xpPerCraft,
          yields: (a.produces ?? []).map((p) => itemMap.get(p.item)?.name ?? p.item).join(' · '),
        })
      }
    }
    return out.sort((x, y) => y.made - x.made)
  })

  onMount(() => {
    void load()
    void loadActiveDeck()
    const timer = setInterval(() => (now = Date.now()), 250)
    return () => clearInterval(timer)
  })

  async function load() {
    error = ''
    try {
      stats = await getStats()
    } catch (e) {
      error = (e as Error).message || 'Could not load your progress.'
    }
    try {
      skills = await getSkills()
      fetchedAt = Date.now()
    } catch {
      // the idle panel is a bonus: a failed board must not blank the page
    }
  }
</script>

<header class="flex items-center justify-between gap-3 border-b border-ink-700 pt-4 pb-4">
  <div class="min-w-0">
    <h1 class="display truncate text-3xl text-ink-100">{session.user?.handle}</h1>
    <p class="mt-1 text-xs text-ink-400">
      {LANG_NAMES[lang] ?? lang} · {levelLabel}{#if deckName}
        · studying {deckName}{/if}
    </p>
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
  <!-- Desktop opens the page into a spread: the rhythm on the left, the earned
       figures on the right. On a phone it stays one ruled column. -->
  <div class="xl:grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:gap-24">
    <section
      class="panel panel-accent mt-4 p-4 xl:flex xl:flex-col"
      style={accentStyle(ACCENT.jade)}
    >
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="text-xs font-bold tracking-widest uppercase" style="color: var(--accent)">
          Activity
        </h2>
        <span class="text-[11px] text-ink-400">last {weeks} weeks</span>
      </div>

      {#if days.length}
        <div class="mt-3 overflow-x-auto pb-1 xl:my-auto">
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
        <p class="mt-3 text-xs text-ink-400 xl:my-auto">Practise to start filling this in.</p>
      {/if}
    </section>

    <section class="mt-2 xl:mt-4" aria-label="Your progress">
      <ul>
        <li class="border-b border-ink-700 px-0 py-3">
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-sm text-ink-300">Study XP</span>
            <span class="display text-xl font-bold text-gold-200 tabular-nums"
              >{#if stats}{stats.xp}{:else}<span
                  class="inline-block h-5 w-12 animate-pulse rounded bg-ink-700"
                ></span>{/if}</span
            >
          </div>
          <p class="mt-1 text-xs text-ink-500">
            From graded cards and won fights — this fills your daily goal, not your account level.
          </p>
        </li>
        <li class="flex items-baseline justify-between gap-3 border-b border-ink-700 px-0 py-3">
          <span class="text-sm text-ink-300">Day streak</span>
          <span class="display text-xl font-bold text-gold-200 tabular-nums"
            >{#if stats}{stats.streak}<span class="ml-1 text-xs font-normal text-ink-400"
                >{stats.streak === 1 ? 'day' : 'days'}</span
              >{:else}<span class="inline-block h-5 w-12 animate-pulse rounded bg-ink-700"
              ></span>{/if}</span
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
            <span class="text-ink-300">Account level</span>
            <span class="text-ink-300 tabular-nums">{stats ? `${stats.level} / 100` : '—'}</span>
          </div>
          <div
            class="bar mt-2"
            role="progressbar"
            aria-label="Account level {stats?.level ?? 1} of 100 — the average of every profession"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={stats ? Math.round(stats.progress * 100) : 0}
          >
            <i style="width: {stats ? Math.min(100, stats.progress * 100) : 0}%"></i>
          </div>
          <p class="mt-2 text-xs text-ink-500">
            The average of every profession, so it climbs as each one levels.
          </p>
        </li>
      </ul>
    </section>
  </div>

  <!-- Idle rigs (docs/DESIGN.md §13.5.1): what is accumulating right now. The
       server settles on fetch; these figures are the client's local estimate. -->
  <section
    class="panel panel-accent mt-4 p-4"
    style={accentStyle(ACCENT.jade)}
    aria-label="Running rigs"
  >
    <div class="flex items-baseline justify-between gap-3">
      <h2 class="text-xs font-bold tracking-widest uppercase" style="color: var(--accent)">Rigs</h2>
      <span class="text-[11px] text-ink-400">
        {#if rigs.length}
          {rigs.length} running
        {:else}
          idle
        {/if}
      </span>
    </div>

    {#if rigs.length}
      <ul class="mt-1">
        {#each rigs as r (r.actionId)}
          <li class="flex items-center gap-3 border-b border-ink-700 py-2.5 last:border-0">
            <span class="w-5 shrink-0 text-center text-base" aria-hidden="true">{r.icon}</span>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline justify-between gap-2">
                <a
                  href={href(`/skills/${r.skillId}#action-${r.actionId}`)}
                  class="truncate text-sm text-ink-200 hover:underline">{r.actionName}</a
                >
                <span class="flex shrink-0 items-baseline gap-2">
                  <span
                    class="display text-[11px] font-bold text-gold-200 tabular-nums"
                    title="Action XP this rig earns per item">+{r.xpPerCraft} xp</span
                  >
                  <span
                    class="display text-sm font-bold tabular-nums"
                    style="color: {r.category.accent}">{r.rate}</span
                  >
                </span>
              </div>
              <div
                class="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] text-ink-500"
              >
                <span class="truncate">{r.yields || '—'}</span>
                <span class="shrink-0 tabular-nums">{fmtClock(r.left)} left</span>
              </div>
              <div
                class="mt-1 h-[3px] overflow-hidden rounded-[2px] border border-ink-700 bg-ink-800"
              >
                <div
                  class="h-full rounded-[2px]"
                  style="width: {r.runPct * 100}%; background: {r.category.accent}"
                ></div>
              </div>
            </div>
            <span
              class="display shrink-0 text-sm font-bold text-gold-200 tabular-nums"
              title="Gathered since you opened this page">+{r.made}</span
            >
          </li>
        {/each}
      </ul>
    {:else}
      <p class="mt-2 text-xs text-ink-400">
        No rigs running — complete a drill in <a
          href={href('/skills')}
          class="underline hover:text-ink-200">Skills</a
        > to power one, then leave it be.
      </p>
    {/if}
  </section>
{/if}
