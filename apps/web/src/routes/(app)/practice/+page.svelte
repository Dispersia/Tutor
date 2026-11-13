<script lang="ts">
  import { onMount } from 'svelte'
  import { componentFor } from '#lib/components/exercises'
  import {
    gradeExercise,
    getStats,
    listDecks,
    nextExercise,
    type Deck,
    type Grade,
    type Instance,
    type Stats,
  } from '#lib/exercises'

  let decks = $state<Deck[]>([])
  let deckId = $state<string>('')
  let instance = $state<Instance | null>(null)
  let result = $state<Grade | null>(null)
  let stats = $state<Stats | null>(null)
  let loading = $state(true)
  let busy = $state(false)
  let error = $state('')
  let startedAt = $state(0)

  onMount(async () => {
    try {
      const [d, s] = await Promise.all([listDecks(), getStats()])
      decks = d.decks
      deckId = decks[0]?.id ?? ''
      stats = s
      await loadNext()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  })

  async function loadNext() {
    error = ''
    result = null
    instance = null
    try {
      const { instance: inst } = await nextExercise(deckId ? { deckId } : {})
      instance = inst
      startedAt = Date.now()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function submit(answer: unknown) {
    if (!instance) return
    busy = true
    error = ''
    try {
      const r = await gradeExercise({
        exerciseId: instance.exerciseId,
        cardId: instance.cardId,
        answer,
        latencyMs: Date.now() - startedAt,
      })
      result = r.result
      if (stats) stats = { ...stats, xp: r.stats.xp, level: r.stats.level }
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  function changeDeck(e: Event) {
    deckId = (e.target as HTMLSelectElement).value
    void loadNext()
  }
</script>

<div class="flex items-center justify-between pt-4 pb-3">
  <h1 class="text-lg font-semibold">Practice</h1>
  <div class="flex items-center gap-2 text-xs">
    <span class="rounded-full bg-neutral-800 px-2 py-1">Lv {stats?.level ?? 1}</span>
    <span class="rounded-full bg-emerald-900/60 px-2 py-1 text-emerald-300">
      {stats?.xp ?? 0} XP
    </span>
  </div>
</div>

<select
  value={deckId}
  onchange={changeDeck}
  class="mb-4 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
>
  {#each decks as d (d.id)}
    <option value={d.id}>{d.name} · {d.cardCount} cards</option>
  {/each}
</select>

{#if loading}
  <p class="text-sm text-neutral-500">Loading…</p>
{:else if error}
  <p class="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
  <button onclick={loadNext} class="mt-3 rounded-xl border border-neutral-700 px-3 py-2 text-sm"
    >Retry</button
  >
{:else if result}
  <div
    class="rounded-2xl border p-5 {result.correct
      ? 'border-emerald-800 bg-emerald-950/40'
      : 'border-amber-800 bg-amber-950/30'}"
  >
    <div class="flex items-baseline justify-between">
      <span class="text-lg font-medium">
        {result.correct ? '✓ Correct' : '✗ Not quite'}
      </span>
      <span class="text-sm text-neutral-300">{result.score}/100 · +{result.xp} XP</span>
    </div>
    {#if result.expected}
      <p class="mt-2 text-sm text-neutral-300">
        Answer: <span class="text-lg">{result.expected}</span>
      </p>
    {/if}
    {#if result.feedback}
      <p class="mt-1 text-sm text-neutral-400">{result.feedback}</p>
    {/if}
  </div>
  <button
    onclick={loadNext}
    class="mt-4 w-full rounded-xl bg-emerald-500 py-3 font-medium text-black">Next →</button
  >
{:else if instance}
  {@const Comp = componentFor(instance.exerciseId)}
  <div class="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
    <Comp {instance} {busy} onsubmit={submit} />
  </div>
{/if}
