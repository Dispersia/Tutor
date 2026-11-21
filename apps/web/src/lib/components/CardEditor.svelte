<script lang="ts">
  import { onMount } from 'svelte'
  import { addDeckCard, getDeckCards, updateDeckCard } from '#lib/exercises'
  import type { Card, PitchContour, PitchLevel } from '#lib/types'
  import Pitch from './Pitch.svelte'
  import Word from './Word.svelte'
  import Spinner from './Spinner.svelte'

  /** A card metadata editor (docs/DESIGN.md §11.1): annotate a deck's cards. */
  let {
    deck,
    onclose,
  }: { deck: { id: string; name: string; targetLang: string }; onclose: () => void } = $props()

  let cards = $state<Card[]>([])
  let loading = $state(true)
  let error = $state('')
  let selectedId = $state('')
  let saving = $state(false)
  let savedAt = $state(0)

  // editable draft for the selected card
  let levels = $state('')
  let drop = $state(0)
  let syllables = $state('')
  let extra = $state('')

  // "add a card" draft
  let showAdd = $state(false)
  let newFront = $state('')
  let newBack = $state('')
  let newReading = $state('')
  let newStep = $state('')
  let adding = $state(false)

  const selected = $derived(cards.find((c) => c.id === selectedId))

  /** The reading a learner should see (kana / zhuyin / pinyin). */
  const readingOf = (c: Card): string =>
    c.readings.kana || c.readings.zhuyin || c.readings.pinyin || Object.values(c.readings)[0] || ''

  /** The contour the draft builds, for the live preview and for saving. */
  const preview = $derived.by<PitchContour | undefined>(() => {
    const lv = levels.toUpperCase().replace(/[^HL]/g, '')
    if (!lv) return undefined
    const syl = syllables.split(/[\s,、]+/).filter(Boolean)
    return {
      levels: [...lv] as PitchLevel[],
      drop: drop > 0 ? drop : null,
      ...(syl.length ? { syllables: syl } : {}),
    }
  })

  onMount(async () => {
    try {
      const { cards: list } = await getDeckCards(deck.id)
      cards = list
      if (list[0]) select(list[0])
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  })

  /** Loads a card's annotations into the editable draft. */
  function select(c: Card) {
    selectedId = c.id
    const pitch = c.metadata?.pitch
    levels = pitch?.levels?.join('') ?? ''
    drop = pitch?.drop ?? 0
    syllables = pitch?.syllables?.join(' ') ?? ''
    const rest: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(c.metadata ?? {})) {
      if (key !== 'pitch') rest[key] = value
    }
    extra = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : ''
    error = ''
    savedAt = 0
  }

  async function save() {
    const c = selected
    if (!c || saving) return
    saving = true
    error = ''
    let rest: Record<string, unknown> = {}
    try {
      const trimmed = extra.trim()
      if (trimmed) rest = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      error = 'Other metadata must be valid JSON.'
      saving = false
      return
    }
    try {
      // Metadata is merged by key, so removed JSON keys are cleared explicitly.
      const metadata: Record<string, unknown> = { ...rest, pitch: preview ?? null }
      for (const key of Object.keys(c.metadata ?? {})) {
        if (key !== 'pitch' && !(key in rest)) metadata[key] = null
      }
      const { card } = await updateDeckCard(deck.id, c.id, { metadata })
      cards = cards.map((x) => (x.id === card.id ? card : x))
      savedAt = Date.now()
    } catch (e) {
      error = (e as Error).message
    } finally {
      saving = false
    }
  }

  const pitchCount = $derived(cards.filter((c) => c.metadata?.pitch).length)

  /** Adds a hand-authored card; `step` places it in an existing lesson. */
  async function addCard() {
    const front = newFront.trim()
    const back = newBack.trim()
    if (!front || !back || adding) return
    adding = true
    error = ''
    try {
      const step = Number(newStep)
      const { card } = await addDeckCard(deck.id, {
        front,
        back,
        reading: newReading.trim() || undefined,
        step: newStep.trim() && Number.isFinite(step) ? step : undefined,
      })
      cards = [...cards, card]
      select(card)
      newFront = ''
      newBack = ''
      newReading = ''
      newStep = ''
      showAdd = false
    } catch (e) {
      error = (e as Error).message
    } finally {
      adding = false
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose()
  }}
/>

<div class="fixed inset-0 z-50 overflow-y-auto bg-ink-950/80 p-2 sm:p-6">
  <div class="relative mx-auto w-full max-w-3xl">
    <button
      type="button"
      aria-label="Close"
      onclick={onclose}
      class="absolute inset-0 -z-10 cursor-default"
    ></button>

    <section class="panel p-4 sm:p-5">
      <div class="flex items-baseline justify-between gap-3">
        <div class="min-w-0">
          <p class="eyebrow">Card metadata</p>
          <h2 class="display truncate text-lg text-ink-100">{deck.name}</h2>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-[13px] text-ink-400">
            {pitchCount}/{cards.length} annotated
          </span>
          <button type="button" onclick={onclose} class="btn btn-ghost px-3 py-2 text-xs">
            Close
          </button>
        </div>
      </div>

      {#if loading}
        <p class="mt-4 flex items-center gap-2 text-sm text-ink-400">
          <Spinner size={14} label="Loading cards" /> Loading cards…
        </p>
      {:else}
        <div class="mt-4">
          <button
            type="button"
            onclick={() => (showAdd = !showAdd)}
            class="text-xs text-ink-400 underline"
          >
            {showAdd ? 'Cancel' : '+ Add a card'}
          </button>
          {#if showAdd}
            <div class="mt-2 grid gap-2 rounded-lg border border-ink-700 p-3 sm:grid-cols-2">
              <input
                bind:value={newFront}
                placeholder="front (meaning)"
                class="rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
              />
              <input
                bind:value={newBack}
                placeholder="back (target text)"
                class="rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
              />
              <input
                bind:value={newReading}
                placeholder="reading (optional)"
                class="rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
              />
              <input
                bind:value={newStep}
                type="number"
                min="1"
                placeholder="step (blank = new, at the end)"
                class="rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onclick={addCard}
                disabled={adding || !newFront.trim() || !newBack.trim()}
                class="btn btn-primary py-2 text-sm disabled:opacity-60 sm:col-span-2"
              >
                {adding ? 'Adding…' : 'Add card'}
              </button>
            </div>
          {/if}
        </div>

        <div class="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <!-- card list -->
          <div class="max-h-[60vh] overflow-y-auto rounded-lg border border-ink-700">
            {#each cards as c (c.id)}
              <button
                type="button"
                onclick={() => select(c)}
                class="flex w-full items-center justify-between gap-2 border-b border-ink-800 px-3 py-2 text-left last:border-b-0 {c.id ===
                selectedId
                  ? 'bg-ink-800'
                  : 'hover:bg-ink-850'}"
              >
                <span class="min-w-0">
                  <span class="display block truncate text-base text-ink-100">{c.back}</span>
                  <span class="block truncate text-[13px] text-ink-400">
                    {c.front}{readingOf(c) ? ` · ${readingOf(c)}` : ''}
                  </span>
                </span>
                {#if c.metadata?.pitch}
                  <span class="chip shrink-0" style="--accent: var(--color-seal-400)">pitch</span>
                {/if}
              </button>
            {/each}
          </div>

          <!-- editor -->
          <div>
            {#if selected}
              <div class="rounded-lg border border-ink-700 px-4 py-4 text-center">
                <Word
                  word={selected.back}
                  reading={readingOf(selected)}
                  lang={selected.targetLang}
                  pitch={preview}
                />
                <p class="mt-2 text-sm text-ink-300">{selected.front}</p>
              </div>

              <p class="eyebrow mt-4">Pitch accent</p>
              <div class="mt-2 grid grid-cols-[2fr_1fr] gap-2">
                <label class="block text-[13px] text-ink-400">
                  Levels (H/L per mora)
                  <input
                    bind:value={levels}
                    placeholder="LHHL"
                    autocomplete="off"
                    autocapitalize="off"
                    class="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-sm uppercase outline-none focus:border-seal-400"
                  />
                </label>
                <label class="block text-[13px] text-ink-400">
                  Drop
                  <input
                    type="number"
                    min="0"
                    bind:value={drop}
                    class="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-seal-400"
                  />
                </label>
              </div>
              <label class="mt-2 block text-[13px] text-ink-400">
                Mora split (optional — defaults to the reading's characters)
                <input
                  bind:value={syllables}
                  placeholder="か み さ ま"
                  autocomplete="off"
                  class="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-seal-400"
                />
              </label>
              <p class="mt-1 text-[13px] text-ink-500">
                Drop counts from 1 — the mora after which the pitch falls; 0 is flat (平板).
              </p>

              <p class="eyebrow mt-4">Other metadata (JSON)</p>
              <textarea
                bind:value={extra}
                rows="3"
                placeholder={'{ "radical": "水", "strokeOrder": 4 }'}
                class="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-xs outline-none focus:border-seal-400"
              ></textarea>

              {#if error}
                <p class="mt-2 rounded-md bg-ember-950 px-3 py-2 text-xs text-ember-300">{error}</p>
              {/if}

              <div class="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onclick={save}
                  disabled={saving}
                  class="btn btn-primary flex-1 py-3 disabled:opacity-60"
                >
                  {#if saving}<Spinner size={14} label="Saving" /> Saving…{:else}Save card{/if}
                </button>
                <button
                  type="button"
                  onclick={() => {
                    levels = ''
                    drop = 0
                    syllables = ''
                  }}
                  disabled={saving}
                  class="btn btn-ghost px-3 py-3 text-xs disabled:opacity-60"
                >
                  Clear pitch
                </button>
              </div>
              {#if savedAt}
                <p class="mt-2 text-center text-[13px] text-jade-400">Saved ✓</p>
              {/if}
            {:else}
              <p class="text-sm text-ink-400">This deck has no cards yet.</p>
            {/if}
          </div>
        </div>
      {/if}

      {#if error && !selected}
        <p class="mt-3 rounded-md bg-ember-950 px-3 py-2 text-sm text-ember-300">{error}</p>
      {/if}
    </section>
  </div>
</div>
