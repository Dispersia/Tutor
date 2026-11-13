<script lang="ts">
  import { onMount } from 'svelte'
  import { session } from '#lib/session.svelte'
  import { LANG_NAMES } from '#lib/voices'
  import { speechStatus, unloadSpeech, wakeSpeech } from '#lib/speech'
  import type { SpeechStatus } from '#lib/types'

  let speech = $state<SpeechStatus | null>(null)
  let note = $state('')

  const lang = $derived(session.user?.targetLang ?? 'zh')

  async function refresh() {
    try {
      speech = await speechStatus()
    } catch {
      speech = null
    }
  }
  onMount(refresh)

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
    <div class="mt-1 text-2xl font-semibold">0</div>
  </div>
  <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3">
    <div class="text-xs text-neutral-500">Streak</div>
    <div class="mt-1 text-2xl font-semibold">0<span class="text-sm"> d</span></div>
  </div>
  <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3">
    <div class="text-xs text-neutral-500">Level</div>
    <div class="mt-1 text-2xl font-semibold">1</div>
  </div>
</section>
<p class="mt-1 text-[11px] text-neutral-600">Gamification (XP, streaks) lands in Phase 6.</p>

<section class="mt-5 space-y-3">
  <a href="/chat" class="block rounded-2xl bg-emerald-500 px-4 py-4 font-medium text-black">
    Start practising →
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
