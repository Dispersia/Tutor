<script lang="ts">
  import { onMount } from 'svelte'
  import { getSrsStats, type SrsStats } from '#lib/curriculum'
  import { getStats, type Stats } from '#lib/exercises'
  import { href } from '#lib/paths'
  import { session } from '#lib/session.svelte'
  import { speechStatus, unloadSpeech, wakeSpeech } from '#lib/speech'
  import { ACCENT, CATEGORY, accentStyle } from '#lib/theme'
  import type { SpeechStatus } from '#lib/types'
  import { LANG_NAMES } from '#lib/voices'

  let stats = $state<Stats | null>(null)
  let srs = $state<SrsStats | null>(null)
  let speech = $state<SpeechStatus | null>(null)
  let note = $state('')

  const lang = $derived(session.user?.targetLang ?? 'zh')

  onMount(async () => {
    try {
      stats = await getStats()
    } catch {
      /* not fatal */
    }
    getSrsStats()
      .then((s) => (srs = s))
      .catch(() => {})
    void refresh()
  })

  async function refresh() {
    try {
      speech = await speechStatus()
    } catch {
      speech = null
    }
  }

  async function wake() {
    note = 'Waking the models up…'
    try {
      speech = await wakeSpeech()
      note = 'Models ready.'
    } catch (e) {
      note = (e as Error).message
    }
  }

  async function free() {
    note = ''
    try {
      await unloadSpeech()
      await refresh()
      note = 'Models unloaded — RAM returned to the Mac.'
    } catch (e) {
      note = (e as Error).message
    }
  }
</script>

<header
  class="panel panel-accent mt-3 mb-3 flex items-center justify-between p-4"
  style={accentStyle(ACCENT.arcane)}
>
  <div>
    <p class="eyebrow">Welcome back</p>
    <h1 class="display text-2xl text-gold-200">{session.user?.handle}</h1>
    <p class="text-xs text-ink-300">
      Learning {LANG_NAMES[lang] ?? lang} · {session.user?.level ?? 'HSK 1'}
    </p>
  </div>
  <div class="grid h-14 w-14 place-items-center rounded-full border border-gold-600 bg-ink-900">
    <span class="text-[9px] leading-none tracking-widest text-ink-400">LV</span>
    <span class="display -mt-0.5 text-lg leading-none text-gold-200">{stats?.level ?? 1}</span>
  </div>
</header>

<section class="grid grid-cols-3 gap-2.5">
  <div class="stat-card p-3" style={accentStyle(ACCENT.xp)}>
    <div class="text-[0.68rem] font-semibold tracking-[0.14em] uppercase opacity-70">XP</div>
    <div class="display mt-1 text-xl font-bold">{stats?.xp ?? 0}</div>
  </div>
  <div class="stat-card p-3" style={accentStyle(ACCENT.streak)}>
    <div class="text-[0.68rem] font-semibold tracking-[0.14em] uppercase opacity-70">Streak</div>
    <div class="display mt-1 text-xl font-bold">
      {stats?.streak ?? 0}<span class="ml-0.5 text-xs opacity-70">days</span>
    </div>
  </div>
  <div class="stat-card p-3" style={accentStyle(ACCENT.level)}>
    <div class="text-[0.68rem] font-semibold tracking-[0.14em] uppercase opacity-70">Reviews</div>
    <div class="display mt-1 text-xl font-bold">{srs?.due ?? 0}</div>
  </div>
</section>

<!-- daily goal -->
<section class="panel panel-accent mt-3" style={accentStyle(ACCENT.xp)}>
  <div class="flex items-baseline justify-between px-4 pt-3 text-sm">
    <span class="display text-gold-200">Daily goal</span>
    <span class="text-ink-400">{stats?.dailyXp ?? 0} / {stats?.dailyGoal ?? 50} XP</span>
  </div>
  <div class="bar mx-4 mt-2 mb-3">
    <i style="width: {(stats?.goalPct ?? 0) * 100}%"></i>
  </div>
  {#if stats && !stats.todayActive}
    <p class="border-t border-ink-700 px-4 py-2 text-xs text-amber-300">
      Practise today to keep your streak alive.
    </p>
  {:else if stats && stats.goalPct >= 1}
    <p class="border-t border-ink-700 px-4 py-2 text-xs text-emerald-300">
      Goal reached — nice work today! 🎉
    </p>
  {/if}
</section>

<!-- level progress -->
{#if stats}
  <section class="panel panel-accent mt-3" style={accentStyle(ACCENT.level)}>
    <div class="flex items-baseline justify-between px-4 pt-3 text-sm">
      <span class="display" style="color: {ACCENT.level}">Level {stats.level}</span>
      <span class="text-ink-400">{stats.intoLevel} / {stats.forNext} XP</span>
    </div>
    <div class="bar mx-4 mt-2 mb-3">
      <i style="width: {stats.progress * 100}%"></i>
    </div>
  </section>
{/if}

<section class="mt-5 grid grid-cols-2 gap-2.5">
  <a
    href={href('/learn')}
    class="tile col-span-2 flex items-center gap-3 p-4"
    style={accentStyle('#12b886')}
  >
    <span class="text-3xl">📖</span>
    <span class="flex-1">
      <span class="display block text-lg text-white">
        {srs && srs.due > 0 ? `${srs.due} cards due` : 'Continue learning'}
      </span>
      <span class="text-xs text-white/80">
        {srs ? `${srs.learned} / ${srs.total} cards learned` : 'Start the guided path'}
      </span>
    </span>
    <span class="text-white/70">→</span>
  </a>

  <a
    href={href('/skills')}
    class="tile flex items-center gap-2 p-3 text-sm"
    style={accentStyle(CATEGORY.artisan.accent)}
  >
    <span class="text-xl">⛏️</span><span>Professions</span>
  </a>
  <a
    href={href('/combat')}
    class="tile flex items-center gap-2 p-3 text-sm"
    style={accentStyle(CATEGORY.combat.accent)}
  >
    <span class="text-xl">⚔️</span><span>Combat</span>
  </a>
  <a
    href={href('/chat')}
    class="tile flex items-center gap-2 p-3 text-sm"
    style={accentStyle(ACCENT.arcane)}
  >
    <span class="text-xl">💬</span><span>Talk to tutor</span>
  </a>
  <a
    href={href('/history')}
    class="tile flex items-center gap-2 p-3 text-sm"
    style={accentStyle(ACCENT.level)}
  >
    <span class="text-xl">📜</span><span>History</span>
  </a>
</section>

<section class="panel panel-accent mt-5 mb-6" style={accentStyle(ACCENT.player)}>
  <div class="flex items-center justify-between px-4 py-3">
    <div>
      <div class="display text-sm text-gold-200">Speech engine</div>
      <div class="text-xs">
        {#if speech?.ready}
          <span class="text-emerald-400">● awake</span>
          <span class="text-ink-400"> — {speech.models.join(', ')}</span>
        {:else if speech?.running}
          <span class="text-amber-400">● starting</span>
        {:else}
          <span class="text-ink-400">● asleep — starts on demand, unloads when idle</span>
        {/if}
      </div>
    </div>
    <div class="flex gap-2">
      {#if !speech?.ready}
        <button onclick={wake} class="btn btn-ghost px-3 py-1.5 text-xs">Wake</button>
      {/if}
      <button onclick={free} class="btn btn-ghost px-3 py-1.5 text-xs">Free RAM</button>
    </div>
  </div>
  {#if note}
    <p class="border-t border-ink-700 px-4 py-2 text-xs text-ink-300">{note}</p>
  {/if}
</section>
