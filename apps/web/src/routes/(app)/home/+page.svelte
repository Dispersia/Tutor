<script lang="ts">
  import { onMount } from 'svelte'
  import { getStats, type Stats } from '#lib/exercises'
  import { getSkills, type SkillsResponse } from '#lib/skills'
  import { session } from '#lib/session.svelte'
  import { activeDeckOf, loadActiveDeck } from '#lib/activeDeck.svelte'
  import { ACCENT, accentStyle } from '#lib/theme'
  import { LANG_NAMES } from '#lib/voices'
  import { htmlLang } from '#lib/lang'
  import { cachedAt, peekCached } from '#lib/cache'
  import { bankSummary, heatWeeks, levelLabelFor, rigRows, xpToGoal } from '#lib/homeview'
  import ActivityHeatmap from '#lib/components/home/ActivityHeatmap.svelte'
  import ProgressList from '#lib/components/home/ProgressList.svelte'
  import RigList from '#lib/components/home/RigList.svelte'
  import BankStrip from '#lib/components/home/BankStrip.svelte'

  // Seed from the last fetch so returning to Home shows the numbers at once
  // instead of blanking to the loading skeleton (see lib/cache.ts).
  let stats = $state<Stats | null>(peekCached<Stats>('/api/stats') ?? null)
  let error = $state('')
  /** The idle panel is optional: Home works even if the board fails to load. */
  let skills = $state<SkillsResponse | null>(peekCached<SkillsResponse>('/api/skills') ?? null)
  /** When the board was fetched — the cursor the live counters extrapolate from. */
  let fetchedAt = $state(cachedAt('/api/skills'))
  /** Ticking clock so a rig's counter climbs in place (§13.5.1). */
  let now = $state(Date.now())

  const lang = $derived(session.user?.targetLang ?? 'zh')
  /** The deck the member studies everywhere, shown beside the language. */
  const deckName = $derived(activeDeckOf()?.name)
  const levelLabel = $derived(levelLabelFor(lang, session.user?.level))
  const toGoal = $derived(xpToGoal(stats))
  const days = $derived(stats?.activity?.days ?? [])
  const weeks = $derived(heatWeeks(days.length))
  const rigs = $derived(rigRows(skills, fetchedAt, now))
  const bank = $derived(bankSummary(skills))

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

<header class="border-b border-ink-700 pt-4 pb-4">
  <div class="flex items-start justify-between gap-4">
    <h1 class="display min-w-0 truncate text-3xl text-ink-100">{session.user?.handle}</h1>
    <div class="shrink-0 text-center">
      <div class="seal h-14 w-14" aria-label="Account level {stats?.level ?? 1}">
        <span class="display text-xl leading-none font-bold">{stats?.level ?? 1}</span>
      </div>
      <p class="seal__label" aria-hidden="true">Level</p>
    </div>
  </div>
  <p class="sub mt-2">
    {LANG_NAMES[lang] ?? lang} · {levelLabel}{#if deckName}
      · studying <span lang={htmlLang(lang)}>{deckName}</span>{/if}
  </p>
</header>

{#if error}
  <div class="banner mt-3" style={accentStyle(ACCENT.brass)} role="alert">
    <p class="banner__text flex-1">Couldn't load your progress — {error}</p>
    <button type="button" class="btn btn-ghost px-3 py-2 text-xs" onclick={load}>Retry</button>
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
