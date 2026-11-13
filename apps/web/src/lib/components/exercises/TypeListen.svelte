<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import { speak } from '#lib/speech'

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

  async function play() {
    err = ''
    playing = true
    try {
      await speak(audioText, { language })
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
    class="w-full rounded-xl border border-neutral-700 bg-neutral-900 py-4 text-lg disabled:opacity-50"
  >
    {playing ? '🔊 playing…' : '🔊 Play again'}
  </button>
  {#if err}<p class="text-xs text-red-300">{err}</p>{/if}
  <input
    bind:value={answer}
    autocomplete="off"
    autocapitalize="off"
    class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-4 text-lg outline-none focus:border-emerald-500"
    placeholder="Type what you hear…"
  />
  <button
    type="submit"
    disabled={busy || !answer.trim()}
    class="w-full rounded-xl bg-emerald-500 py-3 font-medium text-black disabled:opacity-40"
  >
    Check
  </button>
</form>
