<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import { typingAttrs } from '#lib/lang'
  import type { PitchContour } from '#lib/types'
  import { ACCENT } from '#lib/theme'
  import CharCell from '../CharCell.svelte'
  import Spinner from '../Spinner.svelte'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  let answer = $state('')

  const word = $derived((instance.data.word as string) ?? '')
  const reading = $derived((instance.data.reading as string) ?? '')
  const lang = $derived((instance.data.readingLang as string) ?? '')
  const answerLang = $derived((instance.data.answerLang as string) ?? undefined)
  const furigana = $derived(instance.data.furigana as { base: string; ruby?: string }[] | undefined)
  const pitch = $derived(instance.data.pitch as PitchContour | undefined)

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (answer.trim()) onsubmit(answer.trim())
  }
</script>

<form onsubmit={submit} class="space-y-4">
  <p class="text-lg leading-snug">{instance.prompt}</p>
  {#if word}
    <div class="flex justify-center py-2">
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
    </div>
  {/if}
  <input
    bind:value={answer}
    {...typingAttrs(answerLang)}
    class="field text-lg"
    placeholder="Type your answer…"
  />
  <button
    type="submit"
    disabled={busy || !answer.trim()}
    data-enter-action
    class="btn btn-primary w-full py-3"
  >
    {#if busy}<Spinner size={15} label="Checking your answer" /> Checking…{:else}Check{/if}
  </button>
</form>
