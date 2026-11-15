<script lang="ts">
  import type { Instance } from '#lib/exercises'
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
  const furigana = $derived(instance.data.furigana as { base: string; ruby?: string }[] | undefined)

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (answer.trim()) onsubmit(answer.trim())
  }
</script>

<form onsubmit={submit} class="space-y-4">
  <p class="text-lg leading-snug">{instance.prompt}</p>
  {#if word}
    <div class="panel p-4 text-center">
      <Word {word} {reading} {lang} {furigana} />
    </div>
  {/if}
  <input
    bind:value={answer}
    autocomplete="off"
    autocapitalize="off"
    class="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-4 text-lg outline-none focus:border-gold-500"
    placeholder="Type your answer…"
  />
  <button
    type="submit"
    disabled={busy || !answer.trim()}
    class="w-full rounded-xl bg-emerald-500 py-3 font-medium text-black disabled:opacity-40"
  >
    Check
  </button>
</form>
