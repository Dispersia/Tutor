<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import type { PitchContour } from '#lib/types'
  import { ACCENT } from '#lib/theme'
  import CharCell from '../CharCell.svelte'
  import Spinner from '../Spinner.svelte'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  const word = $derived((instance.data.word as string) ?? '')
  const reading = $derived((instance.data.reading as string) ?? '')
  const lang = $derived((instance.data.readingLang as string) ?? '')
  const furigana = $derived(instance.data.furigana as { base: string; ruby?: string }[] | undefined)
  const pitch = $derived(instance.data.pitch as PitchContour | undefined)
  const meaning = $derived((instance.data.meaning as string) ?? '')
  const explanation = $derived((instance.data.explanation as string) ?? '')
  const example = $derived(
    instance.data.example as
      { text: string; reading?: string; gloss?: string; target?: string } | undefined,
  )
  const grammar = $derived(
    instance.data.grammar as
      | {
          rule: string
          explanation?: string
          example?: { text: string; target?: string; gloss?: string; reading?: string }
        }
      | undefined,
  )

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
</script>

<div class="space-y-4">
  {#if grammar}
    <p class="eyebrow">New pattern</p>

    <div class="flex flex-col items-center gap-3 border-y border-ink-700 py-5 text-center">
      <p class="display text-xl text-ink-100">{grammar.rule}</p>
      {#if grammar.example}
        <p class="text-2xl text-ink-100">{grammar.example.text}</p>
        {#if grammar.example.reading && grammar.example.reading !== grammar.example.text}
          <p class="text-sm text-ink-300">{grammar.example.reading}</p>
        {/if}
        {#if grammar.example.gloss}
          <p class="text-xs text-ink-400">{grammar.example.gloss}</p>
        {/if}
      {/if}
      {#if grammar.explanation}
        <p class="max-w-prose text-sm leading-relaxed text-ink-300">{grammar.explanation}</p>
      {/if}
    </div>
  {:else}
    <p class="eyebrow">New word</p>

    <div class="flex flex-col items-center gap-3 border-y border-ink-700 py-5 text-center">
      <CharCell
        {word}
        {reading}
        {lang}
        {furigana}
        {pitch}
        size="lg"
        wordish={word.length > 1}
        accent={ACCENT.azure}
      />
      {#if meaning}
        <p class="text-sm text-ink-300">{meaning}</p>
      {/if}
      {#if explanation}
        <p class="max-w-prose text-sm leading-relaxed text-ink-300">{explanation}</p>
      {/if}
    </div>

    {#if example}
      <div class="panel px-4 py-3">
        <p class="eyebrow">In a sentence</p>
        <p class="display mt-1.5 text-2xl text-ink-100">
          {#each exampleParts as part, i (i)}
            {#if part.hit}<span class="text-seal-300">{part.text}</span>{:else}{part.text}{/if}
          {/each}
        </p>
        {#if example.reading && example.reading !== example.text}
          <p class="mt-0.5 text-sm text-ink-300">{example.reading}</p>
        {/if}
        {#if example.gloss}
          <p class="mt-1 text-xs text-ink-400">{example.gloss}</p>
        {/if}
      </div>
    {/if}
  {/if}

  <button
    type="button"
    onclick={() => onsubmit('ok')}
    disabled={busy}
    data-enter-action
    class="btn btn-primary w-full py-3"
  >
    {#if busy}<Spinner size={15} label="Loading" /> Working…{:else}Got it{/if}
  </button>
</div>
