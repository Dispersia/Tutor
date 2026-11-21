<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import { typingAttrs } from '#lib/lang'
  import { speak } from '#lib/speech'
  import { speechOpts } from '#lib/voices'
  import Icon from '../Icon.svelte'
  import Spinner from '../Spinner.svelte'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  let answer = $state('')
  let playing = $state(false)
  let err = $state('')

  const audioText = $derived((instance.data.audioText as string) ?? '')
  const language = $derived((instance.data.language as string) ?? undefined)
  const answerLang = $derived((instance.data.answerLang as string) ?? language)

  async function play() {
    err = ''
    playing = true
    try {
      await speak(audioText, speechOpts(language))
    } catch (e) {
      err = (e as Error).message
    } finally {
      playing = false
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (answer.trim()) onsubmit(answer.trim())
  }
</script>

<form onsubmit={submit} class="space-y-4">
  <p class="text-lg leading-snug">{instance.prompt}</p>
  <button
    type="button"
    onclick={play}
    disabled={playing}
    class="btn btn-ghost w-full gap-1.5 py-4 text-lg"
  >
    {#if playing}<Spinner size={17} label="Playing audio" /> playing…{:else}<Icon
        name="sound"
        size={17}
      /> Play again{/if}
  </button>
  {#if err}<p class="text-xs text-ember-300">{err}</p>{/if}
  <input
    bind:value={answer}
    {...typingAttrs(answerLang)}
    class="field text-lg"
    placeholder="Type what you hear…"
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
