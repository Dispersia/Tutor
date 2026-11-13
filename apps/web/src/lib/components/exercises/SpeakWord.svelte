<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import { Recorder, micSupported } from '#lib/recorder'
  import { speak, transcribe } from '#lib/speech'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  const recorder = new Recorder()
  const target = $derived((instance.data.target as string) ?? '')
  const reading = $derived((instance.data.reading as string) ?? '')
  const language = $derived((instance.data.language as string) ?? undefined)
  const canMic = micSupported()

  let recording = $state(false)
  let working = $state(false)
  let err = $state('')

  async function record() {
    err = ''
    if (recording) {
      recording = false
      const blob = await recorder.stop()
      working = true
      try {
        const text = await transcribe(blob, language)
        if (text.trim()) onsubmit(text.trim())
        else err = "Didn't catch that — try again."
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

<div class="space-y-4">
  <p class="text-lg leading-snug">{instance.prompt}</p>
  <div class="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 text-center">
    <div class="text-3xl">{target}</div>
    {#if reading}<div class="mt-1 text-sm text-neutral-400">{reading}</div>{/if}
  </div>

  <div class="flex gap-2">
    <button
      type="button"
      onclick={() => speak(target, { language })}
      class="flex-1 rounded-xl border border-neutral-700 py-3 text-sm">🔊 Hear it</button
    >
    {#if canMic}
      <button
        type="button"
        onclick={record}
        disabled={busy || working}
        class="flex-1 rounded-xl py-3 text-sm {recording
          ? 'recording bg-red-600 text-white'
          : 'bg-emerald-500 text-black'} disabled:opacity-50"
      >
        {working ? '…' : recording ? '● Stop & check' : '🎤 Say it'}
      </button>
    {/if}
  </div>
  {#if err}<p class="text-xs text-red-300">{err}</p>{/if}
</div>
