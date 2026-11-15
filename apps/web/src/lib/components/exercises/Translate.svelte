<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import { typingAttrs } from '#lib/lang'
  import type { PitchContour } from '#lib/types'
  import Spinner from '../Spinner.svelte'
  import Word from '../Word.svelte'

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
      <span class="cell min-h-[7rem] min-w-[7rem] px-7 py-5"
        ><Word {word} {reading} {lang} {furigana} {pitch} /></span
      >
    </div>
  {/if}
  <input
    bind:value={answer}
    {...typingAttrs(answerLang)}
    class="w-full rounded-md border border-ink-600 bg-ink-900 px-4 py-4 text-lg outline-none focus:border-seal-400"
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
