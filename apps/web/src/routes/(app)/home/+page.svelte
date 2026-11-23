<script lang="ts">
  import { onMount } from 'svelte'
  import type { Stats } from '#lib/exercises'
  import { useSkills } from '#lib/skills/store.svelte'
  import { session } from '#lib/session.svelte'
  import { activeDeckOf, loadActiveDeck } from '#lib/activeDeck.svelte'
  import { ACCENT, accentStyle } from '#lib/theme'
  import { LANG_NAMES } from '#lib/voices'
  import { htmlLang } from '#lib/lang'
  import { cachedResource } from '#lib/resource.svelte'
  import { bankSummary, heatWeeks, levelLabelFor, rigRows, xpToGoal } from '#lib/homeview'
  import ActivityHeatmap from '#lib/components/home/ActivityHeatmap.svelte'
  import ProgressList from '#lib/components/home/ProgressList.svelte'
  import RigList from '#lib/components/home/RigList.svelte'
  import BankStrip from '#lib/components/home/BankStrip.svelte'

  const progress = cachedResource<Stats>('/api/stats', {
    auto: false,
    fallback: 'Could not load your progress.',
  })
  const stats = $derived(progress.data ?? null)
  const board = useSkills()
  const skills = $derived(board.data ?? null)

  const lang = $derived(session.user?.targetLang ?? 'zh')
  const deckName = $derived(activeDeckOf()?.name)
  const levelLabel = $derived(levelLabelFor(lang, session.user?.level))
  const toGoal = $derived(xpToGoal(stats))
  const days = $derived(stats?.activity?.days ?? [])
  const weeks = $derived(heatWeeks(days.length))
  const rigs = $derived(rigRows(skills, board.fetchedAt, board.now))
  const bank = $derived(bankSummary(skills))

  onMount(() => {
    void load()
    void loadActiveDeck()
  })

  async function load() {
    progress.error = ''
    await progress.refresh()
    await board.refresh()
  }
</script>

<header class="border-b border-ink-700 pt-4 pb-4">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h1 class="display min-w-0 truncate text-3xl text-ink-100">{session.user?.handle}</h1>
      <p class="sub mt-2">
        {LANG_NAMES[lang] ?? lang} · {levelLabel}{#if deckName}
          · studying <span lang={htmlLang(lang)}>{deckName}</span>{/if}
      </p>
    </div>
    <div class="shrink-0 text-center">
      <div class="seal h-14 w-14" aria-label="Account level {stats?.level ?? 1}">
        <span class="display text-xl leading-none font-bold">{stats?.level ?? 1}</span>
      </div>
      <p class="seal__label" aria-hidden="true">Level</p>
    </div>
  </div>
</header>

{#if progress.error}
  <div class="banner mt-3" style={accentStyle(ACCENT.brass)} role="alert">
    <p class="banner__text flex-1">Couldn't load your progress — {progress.error}</p>
    <button type="button" class="btn btn-ghost px-3 py-2 text-xs" onclick={load}>Retry</button>
  </div>
{:else}
  <div class="xl:grid xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:gap-5">
    <section
      class="panel panel-accent mt-4 p-4 xl:flex xl:flex-col"
      style={accentStyle(ACCENT.jade)}
    >
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="eyebrow" style="color: var(--accent)">Activity</h2>
        <span class="text-xs text-ink-400">last {weeks} weeks</span>
      </div>

      <ActivityHeatmap {days} today={stats?.activity?.today} />
    </section>

    <ProgressList {stats} {toGoal} />
  </div>

  <RigList {rigs} />

  <BankStrip coins={bank.coins} kinds={bank.kinds} worn={bank.worn} />
{/if}
