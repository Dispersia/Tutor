<script lang="ts">
  import type { CurriculumDeck } from '#lib/curriculum'
  import {
    backfillPitch,
    deleteDeck,
    updateDeck,
    type DeckSettings as DeckSettingsPatch,
  } from '#lib/exercises'
  import Spinner from './Spinner.svelte'
  import { focusTrap } from '#lib/focusTrap'

  /** Deck-level settings (docs/DESIGN.md §13.8): readings, pitch accent, delete. */
  let {
    deck,
    onclose,
    onchanged,
  }: {
    deck: CurriculumDeck
    onclose: () => void
    /** Called after a change so the page can reload its deck list. */
    onchanged: () => void | Promise<void>
  } = $props()

  // The modal is mounted fresh per deck (`{#if settingsDeck}`), so seeding the
  // editable state from the prop once is intentional.
  // svelte-ignore state_referenced_locally
  let showReadings = $state(deck.settings?.showReadings ?? true)
  // svelte-ignore state_referenced_locally
  let pitchAccent = $state(deck.settings?.pitchAccent ?? false)
  let saving = $state('')
  let deleting = $state(false)
  let backfilling = $state(false)
  let note = $state('')
  let error = $state('')

  const isJapanese = $derived(deck.targetLang === 'ja')

  async function patch(settings: DeckSettingsPatch) {
    saving = Object.keys(settings)[0] ?? ''
    error = ''
    try {
      await updateDeck(deck.deckId, { settings })
      await onchanged()
    } catch (e) {
      error = (e as Error).message
    } finally {
      saving = ''
    }
  }

  /** Annotate the cards the deck already has — pitch is only generated for new ones. */
  async function backfill(force = false) {
    if (backfilling) return
    backfilling = true
    note = ''
    error = ''
    try {
      const { updated, total } = await backfillPitch(deck.deckId, { force })
      note = force
        ? `Re-annotated ${updated} of ${total} cards from the dictionary.`
        : updated > 0
          ? `Annotated ${updated} of ${total} cards with pitch.`
          : 'Every card already has a pitch contour.'
      await onchanged()
    } catch (e) {
      error = (e as Error).message
    } finally {
      backfilling = false
    }
  }

  async function remove() {
    if (deleting) return
    const ok = confirm(
      `Delete “${deck.name}” and all its cards, reviews and history? This cannot be undone.`,
    )
    if (!ok) return
    deleting = true
    error = ''
    try {
      await deleteDeck(deck.deckId)
      await onchanged()
      onclose()
    } catch (e) {
      error = (e as Error).message
      deleting = false
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose()
  }}
/>

<div class="fixed inset-0 z-50 overflow-y-auto bg-ink-950/90 p-2 sm:p-6">
  <div class="relative mx-auto flex min-h-full w-full max-w-lg flex-col">
    <button
      type="button"
      aria-label="Close"
      onclick={onclose}
      class="absolute inset-0 cursor-default"
    ></button>

    <div
      role="dialog"
      aria-modal="true"
      use:focusTrap
      aria-labelledby="deck-settings-title"
      class="panel relative z-10 my-auto p-4 sm:p-5"
    >
      <div class="flex items-baseline justify-between gap-3">
        <div class="min-w-0">
          <p class="eyebrow">Deck settings</p>
          <h2 id="deck-settings-title" class="display truncate text-lg text-ink-100">
            {deck.name}
          </h2>
        </div>
        <div class="flex items-center gap-3">
          {#if saving}<span class="text-xs text-ink-400">Saving…</span>{/if}
          <button type="button" onclick={onclose} class="btn btn-ghost px-3 py-2 text-xs">
            Close
          </button>
        </div>
      </div>

      <div class="mt-4 space-y-2">
        <label class="flex min-h-11 items-center justify-between gap-3 py-1">
          <span class="text-sm">Show readings (ruby)</span>
          <input
            type="checkbox"
            checked={showReadings}
            onchange={(e) => {
              showReadings = e.currentTarget.checked
              patch({ showReadings })
            }}
            class="h-4 w-4 accent-seal-400"
          />
        </label>

        {#if isJapanese}
          <label class="flex min-h-11 items-center justify-between gap-3 py-1">
            <span class="text-sm">Pitch accent (高低アクセント)</span>
            <input
              type="checkbox"
              checked={pitchAccent}
              onchange={(e) => {
                pitchAccent = e.currentTarget.checked
                patch({ pitchAccent })
              }}
              class="h-4 w-4 accent-seal-400"
            />
          </label>
        {/if}
      </div>

      {#if isJapanese}
        <p class="mt-2 text-xs text-ink-400">
          Pitch accent is looked up in the bundled Kanjium dictionary (CC BY-SA 4.0); the generator
          fills in words the dictionary does not know. It reaches new cards only, so backfill the
          cards a deck already has.
        </p>
        <div class="mt-2 grid gap-2">
          <button
            type="button"
            onclick={() => backfill(false)}
            disabled={backfilling}
            class="btn btn-ghost w-full py-2 text-xs"
          >
            {#if backfilling}<Spinner size={13} label="Annotating pitch" /> Annotating…{:else}Backfill
              pitch for existing cards{/if}
          </button>
          <button
            type="button"
            onclick={() => backfill(true)}
            disabled={backfilling}
            class="btn btn-ghost w-full py-2 text-xs"
          >
            Re-annotate from dictionary (fixes wrong contours)
          </button>
        </div>
      {/if}

      {#if note}<p class="mt-2 text-center text-xs text-jade-400">{note}</p>{/if}
      {#if error}
        <p class="banner mt-2 text-xs" style="--accent: var(--color-ember-400)" role="alert">
          {error}
        </p>
      {/if}

      <div class="mt-5 border-t border-ink-700 pt-4">
        <p class="eyebrow text-ember-400">Danger zone</p>
        <button
          type="button"
          onclick={remove}
          disabled={deleting}
          class="btn btn-danger mt-2 w-full py-2 text-xs"
        >
          {#if deleting}Deleting…{:else}Delete this deck{/if}
        </button>
        <p class="mt-1 text-xs text-ink-400">
          Deletes the deck, its cards, reviews and history. Cannot be undone.
        </p>
      </div>
    </div>
  </div>
</div>
