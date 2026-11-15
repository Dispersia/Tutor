<script lang="ts">
  import { onMount } from 'svelte'
  import { getSrsStats, type SrsStats } from '#lib/curriculum'
  import { getStats, type Stats } from '#lib/exercises'
  import { href } from '#lib/paths'
  import { session } from '#lib/session.svelte'
  import { ACCENT, CATEGORY, accentStyle } from '#lib/theme'
  import { LANG_NAMES } from '#lib/voices'

  let stats = $state<Stats | null>(null)
  let srs = $state<SrsStats | null>(null)
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
  const due = $derived(srs?.due ?? 0)
  const toGoal = $derived(stats ? Math.max(0, stats.dailyGoal - stats.dailyXp) : 0)

  onMount(load)

  async function load() {
    error = ''
    try {
      stats = await getStats()
    } catch (e) {
      error = (e as Error).message || 'Could not load your progress.'
    }
    try {
      srs = await getSrsStats()
    } catch {
      /* reviews are optional; the action falls back to "Start practising" */
    }
  }
</script>

<header class="flex items-center justify-between gap-3 pt-4 pb-4">
  <div class="min-w-0">
    <h1 class="display truncate text-2xl text-gold-200">{session.user?.handle}</h1>
    <p class="text-xs text-ink-400">
      Learning {LANG_NAMES[lang] ?? lang} · {levelLabel}
    </p>
  </div>
  <div
    class="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-gold-500 bg-ink-900"
  >
    <span class="eyebrow leading-none">LV</span>
    <span class="display -mt-0.5 text-lg leading-none text-gold-200">{stats?.level ?? 1}</span>
  </div>
</header>

<a href={href('/practice')} class="btn btn-primary w-full gap-2 py-3 text-base">
  {due > 0 ? `Practise ${due} due` : 'Start practising'}
  <span aria-hidden="true">→</span>
</a>

<section class="mt-4 grid grid-cols-2 gap-2.5">
  <a
    href={href('/chat')}
    class="tile flex items-center gap-2 p-3 text-sm"
    style={accentStyle(ACCENT.arcane)}
  >
    <span class="text-xl" aria-hidden="true">🗣️</span><span class="text-ink-100">Talk to tutor</span
    >
  </a>
  <a
    href={href('/skills')}
    class="tile flex items-center gap-2 p-3 text-sm"
    style={accentStyle(CATEGORY.artisan.accent)}
  >
    <span class="text-xl" aria-hidden="true">⛏️</span><span class="text-ink-100">Skills</span>
  </a>
</section>

{#if error}
  <div class="panel mt-4 flex items-center justify-between gap-3 p-3" role="alert">
    <p class="text-xs text-amber-300">Couldn't load your progress — {error}</p>
    <button type="button" class="btn btn-ghost px-3 py-1.5 text-xs" onclick={load}>Retry</button>
  </div>
{:else}
  <section class="panel mt-4" style={accentStyle(ACCENT.green)} aria-label="Your progress">
    <div class="grid grid-cols-2 divide-x divide-ink-700 border-b border-ink-700">
      <div class="px-4 py-3">
        <div class="eyebrow">XP</div>
        <div class="display mt-1 text-xl font-bold text-gold-200 tabular-nums">
          {#if stats}
            {stats.xp}
          {:else}
            <span class="inline-block h-6 w-12 animate-pulse rounded bg-ink-700"></span>
          {/if}
        </div>
      </div>
      <div class="px-4 py-3">
        <div class="eyebrow">Streak</div>
        <div class="display mt-1 text-xl font-bold text-gold-200 tabular-nums">
          {#if stats}
            {stats.streak}<span class="ml-1 text-xs font-normal text-ink-400"
              >{stats.streak === 1 ? 'day' : 'days'}</span
            >
          {:else}
            <span class="inline-block h-6 w-12 animate-pulse rounded bg-ink-700"></span>
          {/if}
        </div>
      </div>
    </div>

    {#if stats}
      <div class="flex items-baseline justify-between gap-2 px-4 pt-3 text-sm">
        <span class="font-semibold text-ink-100">Daily goal</span>
        <span class="text-ink-400 tabular-nums">{stats.dailyXp} / {stats.dailyGoal} XP</span>
      </div>
      <div
        class="bar mx-4 mt-2"
        role="progressbar"
        aria-label="Daily goal"
        aria-valuemin="0"
        aria-valuemax={stats.dailyGoal}
        aria-valuenow={stats.dailyXp}
      >
        <i style="width: {Math.min(100, stats.goalPct * 100)}%"></i>
      </div>
      <p
        class="px-4 py-2 text-xs {stats.goalPct >= 1
          ? 'text-emerald-300'
          : stats.todayActive
            ? 'text-ink-300'
            : 'text-amber-300'}"
      >
        {#if stats.goalPct >= 1}
          Goal reached — nice work today!
        {:else if stats.todayActive}
          {toGoal} XP to your daily goal.
        {:else}
          Practise today to keep your streak alive.
        {/if}
      </p>

      <div class="border-t border-ink-700 px-4 pt-3 pb-3">
        <div class="flex items-baseline justify-between gap-2 text-sm">
          <span class="font-semibold text-ink-100">Next level</span>
          <span class="text-ink-400 tabular-nums">{stats.intoLevel} / {stats.forNext} XP</span>
        </div>
        <div
          class="bar mt-2"
          role="progressbar"
          aria-label="Progress to level {stats.level + 1}"
          aria-valuemin="0"
          aria-valuemax={stats.forNext}
          aria-valuenow={stats.intoLevel}
        >
          <i style="width: {Math.min(100, stats.progress * 100)}%"></i>
        </div>
      </div>
    {:else}
      <div class="space-y-2 px-4 py-3">
        <span class="block h-3 w-24 animate-pulse rounded bg-ink-700"></span>
        <span class="block h-2 w-full animate-pulse rounded bg-ink-800"></span>
      </div>
    {/if}
  </section>
{/if}
