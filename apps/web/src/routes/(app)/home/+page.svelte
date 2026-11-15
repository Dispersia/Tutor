<script lang="ts">
  import { onMount } from 'svelte'
  import { getCurriculum, getSrsStats, type CurriculumDeck, type SrsStats } from '#lib/curriculum'
  import { getStats, type Stats } from '#lib/exercises'
  import { href } from '#lib/paths'
  import { session } from '#lib/session.svelte'
  import { ACCENT, accentStyle } from '#lib/theme'
  import { LANG_NAMES } from '#lib/voices'
  import Icon from '#lib/components/Icon.svelte'

  let stats = $state<Stats | null>(null)
  let srs = $state<SrsStats | null>(null)
  let decks = $state<CurriculumDeck[]>([])
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

  /** The next word on the path — the entry the page is "open" at. */
  const next = $derived.by(() => {
    const ordered = [...decks].sort((a, b) => rank(a.level) - rank(b.level))
    for (const d of ordered) {
      const l = d.lessons.find((x) => !x.complete && x.newWord) ?? d.lessons.find((x) => x.newWord)
      if (l?.newWord) return { ...l, deck: d.name }
    }
    return null
  })

  const rank = (level: string | null) => (level === 'zhfreq' ? 0 : level === 'hsk1' ? 1 : 2)

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
    try {
      decks = (await getCurriculum()).decks
    } catch {
      /* the next-word plate is optional */
    }
  }
</script>

<header class="flex items-center justify-between gap-3 border-b border-ink-700 pt-5 pb-4">
  <div class="min-w-0">
    <h1 class="display truncate text-3xl text-ink-100">{session.user?.handle}</h1>
    <p class="mt-1 text-xs text-ink-400">{LANG_NAMES[lang] ?? lang} · {levelLabel}</p>
  </div>
  <div class="seal h-14 w-14 shrink-0" aria-label="Level {stats?.level ?? 1}">
    <span class="text-2xl leading-none font-bold">{stats?.level ?? 1}</span>
    <span class="text-[8px] tracking-[0.16em]">LEVEL</span>
  </div>
</header>

<a
  href={href('/practice')}
  class="btn btn-primary mt-4 flex w-full justify-between py-3.5 text-base"
>
  <span>{due > 0 ? `Practise ${due} due` : 'Start practising'}</span>
  <span aria-hidden="true">→</span>
</a>

{#if next}
  <a
    href={href('/practice')}
    class="mt-4 flex items-center gap-4 border-b border-ink-700 pb-4"
    style={accentStyle(ACCENT.azure)}
  >
    <span class="cell h-20 w-20 shrink-0">
      <span class="display text-3xl leading-none">{next.newWord}</span>
    </span>
    <span class="min-w-0 flex-1">
      <span class="eyebrow" style="color: var(--accent)">Next up</span>
      <span class="display mt-1 block truncate text-xl text-ink-100"
        >{next.reading || 'New word'}</span
      >
      <span class="mt-0.5 block truncate text-xs text-ink-400">{next.deck} · {next.description}</span
      >
    </span>
    <span class="shrink-0 text-lg text-ink-500" aria-hidden="true">›</span>
  </a>
{/if}

{#if error}
  <div class="panel mt-3 flex items-center justify-between gap-3 p-3" role="alert">
    <p class="text-xs text-brass-300">Couldn't load your progress — {error}</p>
    <button type="button" class="btn btn-ghost px-3 py-1.5 text-xs" onclick={load}>Retry</button>
  </div>
{:else}
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

<nav class="mt-3 pb-4" aria-label="Shortcuts">
  <a
    href={href('/chat')}
    class="flex items-center gap-3 border-t border-ink-700 py-3.5"
    style={accentStyle(ACCENT.azure)}
  >
    <Icon name="chat" size={20} />
    <span class="flex-1 text-sm text-ink-100">Talk to tutor</span>
    <span class="text-ink-500" aria-hidden="true">→</span>
  </a>
  <a
    href={href('/skills')}
    class="flex items-center gap-3 border-t border-ink-700 py-3.5"
    style={accentStyle(ACCENT.brass)}
  >
    <Icon name="skills" size={20} />
    <span class="flex-1 text-sm text-ink-100">Skills</span>
    <span class="text-ink-500" aria-hidden="true">→</span>
  </a>
</nav>
