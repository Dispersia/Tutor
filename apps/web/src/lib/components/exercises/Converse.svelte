<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import { Recorder, micSupported } from '#lib/recorder'
  import { transcribe } from '#lib/speech'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  const recorder = new Recorder()
  const language = $derived((instance.data.language as string) ?? undefined)
  const canMic = micSupported()

  let answer = $state('')
  let recording = $state(false)
  let working = $state(false)
  let err = $state('')

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (answer.trim()) onsubmit(answer.trim())
  }

  async function record() {
    err = ''
    if (recording) {
      recording = false
      const blob = await recorder.stop()
      working = true
      try {
        const text = await transcribe(blob, language)
        if (text.trim()) answer = text.trim()
      } catch (e) {
        err = (e as Error).message
      } finally {
        working = false
      }
    } else {
      try {
        await recorder.start()
        recording = true
      } catch (e) {
        err = `Mic unavailable (needs HTTPS). ${(e as Error).message}`
      }
    }
  }
</script>

<form onsubmit={submit} class="space-y-4">
  <p class="text-lg leading-snug">{instance.prompt}</p>
  <textarea
    bind:value={answer}
    rows="2"
    class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-emerald-500"
    placeholder="Write or say a sentence…"
  ></textarea>
  <div class="flex gap-2">
    {#if canMic}
      <button
        type="button"
        onclick={record}
        disabled={busy || working}
        class="rounded-xl px-4 py-3 text-sm {recording
          ? 'recording bg-red-600 text-white'
          : 'border border-neutral-700'} disabled:opacity-50"
      >
        {working ? '…' : recording ? '● Stop' : '🎤'}
      </button>
    {/if}
    <button
      type="submit"
      disabled={busy || !answer.trim()}
      class="flex-1 rounded-xl bg-emerald-500 py-3 font-medium text-black disabled:opacity-40"
    >
      Send
    </button>
  </div>
  {#if err}<p class="text-xs text-red-300">{err}</p>{/if}
</form>
