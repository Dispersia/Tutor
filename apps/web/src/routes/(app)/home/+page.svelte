<script lang="ts">
  import { onMount } from 'svelte'
  import { getStats, type Stats } from '#lib/exercises'
  import { session } from '#lib/session.svelte'
  import { speechStatus, unloadSpeech, wakeSpeech } from '#lib/speech'
  import type { SpeechStatus } from '#lib/types'
  import { LANG_NAMES } from '#lib/voices'

  let stats = $state<Stats | null>(null)
  let speech = $state<SpeechStatus | null>(null)
  let note = $state('')

  const lang = $derived(session.user?.targetLang ?? 'zh')

  onMount(async () => {
    try {
      stats = await getStats()
    } catch {
      /* not fatal */
    }
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

<header class="pt-4 pb-5">
  <h1 class="text-2xl font-semibold tracking-tight">Hi, {session.user?.handle}</h1>
  <p class="text-sm text-neutral-400">
    Learning {LANG_NAMES[lang] ?? lang} · {session.user?.level ?? 'HSK 1'}
  </p>
</header>

<section class="grid grid-cols-3 gap-3">
  <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3">
    <div class="text-xs text-neutral-500">XP</div>
    <div class="mt-1 text-2xl font-semibold">{stats?.xp ?? 0}</div>
  </div>
  <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3">
    <div class="text-xs text-neutral-500">Streak</div>
    <div class="mt-1 text-2xl font-semibold">
      {stats?.streak ?? 0}<span class="text-sm"> d</span>
    </div>
  </div>
  <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3">
    <div class="text-xs text-neutral-500">Level</div>
    <div class="mt-1 text-2xl font-semibold">{stats?.level ?? 1}</div>
  </div>
</section>

<!-- daily goal -->
<section class="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
  <div class="flex items-baseline justify-between text-sm">
    <span class="font-medium">Daily goal</span>
    <span class="text-neutral-400">{stats?.dailyXp ?? 0} / {stats?.dailyGoal ?? 50} XP</span>
  </div>
  <div class="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
    <div
      class="h-full rounded-full bg-emerald-500 transition-all"
      style="width: {(stats?.goalPct ?? 0) * 100}%"
    ></div>
  </div>
  {#if stats && !stats.todayActive}
    <p class="mt-2 text-xs text-amber-400">Practise today to keep your streak alive.</p>
  {:else if stats && stats.goalPct >= 1}
    <p class="mt-2 text-xs text-emerald-400">Goal reached — nice work today! 🎉</p>
  {/if}
</section>

<!-- level progress -->
{#if stats}
  <section class="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
    <div class="flex items-baseline justify-between text-sm">
      <span class="font-medium">Level {stats.level}</span>
      <span class="text-neutral-400">{stats.intoLevel} / {stats.forNext} XP</span>
    </div>
    <div class="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
      <div
        class="h-full rounded-full bg-sky-500 transition-all"
        style="width: {stats.progress * 100}%"
      ></div>
    </div>
  </section>
{/if}

<section class="mt-5 space-y-3">
  <a href="/skills" class="block rounded-2xl bg-emerald-500 px-4 py-4 font-medium text-black">
    Train a profession →
  </a>
  <a
    href="/combat"
    class="block rounded-2xl border border-neutral-800 bg-neutral-900/50 px-4 py-4 text-sm"
  >
    ⚔️ Fight monsters
  </a>
  <a
    href="/chat"
    class="block rounded-2xl border border-neutral-800 bg-neutral-900/50 px-4 py-4 text-sm"
  >
    Talk to your tutor
  </a>
  <a
    href="/history"
    class="block rounded-2xl border border-neutral-800 bg-neutral-900/50 px-4 py-4 text-sm"
  >
    Browse your history
  </a>
</section>

<section class="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
  <div class="flex items-center justify-between">
    <div>
      <div class="text-sm font-medium">Speech engine</div>
      <div class="text-xs text-neutral-400">
        {#if speech?.ready}
          <span class="text-emerald-400">● awake</span> — {speech.models.join(', ')}
        {:else if speech?.running}
          <span class="text-amber-400">● starting</span>
        {:else}
          <span class="text-neutral-500">● asleep</span> — starts on demand, unloads when idle
        {/if}
      </div>
    </div>
    <div class="flex gap-2">
      {#if !speech?.ready}
        <button onclick={wake} class="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs"
          >Wake</button
        >
      {/if}
      <button onclick={free} class="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs"
        >Free RAM</button
      >
    </div>
  </div>
  {#if note}<p class="mt-2 text-xs text-neutral-400">{note}</p>{/if}
</section>
