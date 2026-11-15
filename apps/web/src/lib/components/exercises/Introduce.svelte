<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import type { PitchContour } from '#lib/types'
  import { speak } from '#lib/speech'
  import { speechOpts } from '#lib/voices'
  import Icon from '../Icon.svelte'
  import Spinner from '../Spinner.svelte'
  import Word from '../Word.svelte'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  let playing = $state(false)
  let err = $state('')

  const word = $derived((instance.data.word as string) ?? '')
  const reading = $derived((instance.data.reading as string) ?? '')
  const lang = $derived((instance.data.readingLang as string) ?? '')
  const furigana = $derived(instance.data.furigana as { base: string; ruby?: string }[] | undefined)
  const pitch = $derived(instance.data.pitch as PitchContour | undefined)
  const meaning = $derived((instance.data.meaning as string) ?? '')
  const example = $derived(
    instance.data.example as
      { text: string; reading?: string; gloss?: string; target?: string } | undefined,
  )

  /** Split the example so the new word can be highlighted. */
  const exampleParts = $derived.by(() => {
    if (!example) return [] as { text: string; hit: boolean }[]
    const hit = example.target || word
    const i = hit ? example.text.indexOf(hit) : -1
    if (!hit || i < 0) return [{ text: example.text, hit: false }]
    return [
      { text: example.text.slice(0, i), hit: false },
      { text: hit, hit: true },
      { text: example.text.slice(i + hit.length), hit: false },
    ].filter((p) => p.text)
  })

  async function play() {
    if (!word) return
    err = ''
    playing = true
    try {
      await speak(word, speechOpts(lang))
    } catch (e) {
      err = (e as Error).message
    } finally {
      playing = false
    }
  }
</script>

<div class="space-y-4">
  <p class="text-xs uppercase tracking-wide text-ink-400">New word</p>

  <div class="border-y border-ink-700 py-5 text-center">
    <Word {word} {reading} {lang} {furigana} {pitch} />
    {#if meaning}
      <p class="mt-2 text-sm text-ink-300">{meaning}</p>
    {/if}
    <button
      type="button"
      onclick={play}
      disabled={playing}
      class="btn btn-ghost mt-3 gap-1.5 px-3 py-2 text-xs disabled:opacity-50"
    >
      {#if playing}<Spinner size={14} label="Playing audio" /> playing…{:else}<Icon
          name="sound"
          size={14}
        /> Hear it{/if}
    </button>
    {#if err}<p class="mt-1 text-xs text-ember-300">{err}</p>{/if}
  </div>

  {#if example}
    <div class="rounded-lg border border-ink-700 px-4 py-3">
      <p class="text-xs uppercase tracking-wide text-ink-400">In a sentence</p>
      <p class="display mt-1 text-2xl text-ink-100">
        {#each exampleParts as part (part.text + part.hit)}
          {#if part.hit}<span class="text-seal-300">{part.text}</span>{:else}{part.text}{/if}
        {/each}
      </p>
      {#if example.reading}
        <p class="mt-0.5 text-sm tracking-wide text-ink-300">{example.reading}</p>
      {/if}
      {#if example.gloss}
        <p class="mt-1 text-xs text-ink-400">{example.gloss}</p>
      {/if}
    </div>
  {/if}

  <button
    type="button"
    onclick={() => onsubmit('ok')}
    disabled={busy}
    data-enter-action
    class="btn btn-primary w-full py-3 disabled:opacity-60"
  >
    {#if busy}<Spinner size={15} label="Loading" /> Working…{:else}Got it{/if}
  </button>
</div>
