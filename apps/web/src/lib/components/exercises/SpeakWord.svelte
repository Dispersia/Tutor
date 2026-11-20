<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import type { PitchContour } from '#lib/types'
  import { typingAttrs } from '#lib/lang'
  import { Recorder, micSupported, MIN_CLIP_MS } from '#lib/recorder'
  import { speak, stopAudio, transcribe } from '#lib/speech'
  import { speechOpts } from '#lib/voices'
  import Word from '../Word.svelte'
  import Icon from '../Icon.svelte'
  import Spinner from '../Spinner.svelte'

  let {
    instance,
    busy = false,
    onsubmit,
    onspeak,
  }: {
    instance: Instance
    busy?: boolean
    onsubmit: (answer: string) => void
    onspeak?: (audio: Blob) => void
  } = $props()

  const recorder = new Recorder()
  const target = $derived((instance.data.target as string) ?? '')
  const reading = $derived((instance.data.reading as string) ?? '')
  const lang = $derived((instance.data.readingLang as string) ?? '')
  const furigana = $derived(instance.data.furigana as { base: string; ruby?: string }[] | undefined)
  const pitch = $derived(instance.data.pitch as PitchContour | undefined)
  const language = $derived((instance.data.language as string) ?? undefined)
  const canMic = micSupported()

  let recording = $state(false)
  let working = $state(false)
  let err = $state('')

  async function record() {
    err = ''
    if (recording) {
      recording = false
      const take = await recorder.stop()
      if (take.durationMs < MIN_CLIP_MS) {
        err = 'That was too quick — hold the mic and speak.'
        return
      }
      if (!take.blob) {
        err = "Didn't catch that — try again."
        return
      }
      if (onspeak) {
        onspeak(take.blob)
        return
      }
      working = true
      try {
        const text = await transcribe(take.blob, language)
        if (text.trim()) onsubmit(text.trim())
        else err = "Didn't catch that — try again."
      } catch (e) {
        err = (e as Error).message
      } finally {
        working = false
      }
    } else {
      stopAudio()
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
  <div class="flex justify-center py-2">
    <span class="cell min-h-[7rem] min-w-[7rem] px-7 py-5"
      ><Word word={target} {reading} {lang} {furigana} {pitch} /></span
    >
  </div>

  <div class="flex gap-2">
    <button
      type="button"
      onclick={() => speak(target, speechOpts(language))}
      class="btn btn-ghost flex-1 gap-1.5 py-3"><Icon name="sound" size={15} /> Hear it</button
    >
    {#if canMic}
      <button
        type="button"
        onclick={record}
        disabled={busy || working}
        class="btn flex-1 gap-1.5 py-3 {recording
          ? 'recording bg-red-600 text-white'
          : 'btn-primary'}"
      >
        {#if working}<Spinner size={15} label="Transcribing your voice" cls="my-0.5" /> Transcribing…
        {:else if busy}<Spinner size={15} label="Checking your answer" cls="my-0.5" /> Checking…
        {:else if recording}■ Stop &amp; check{:else}<Icon name="mic" size={15} /> Say it{/if}
      </button>
    {/if}
  </div>
  {#if err}<p class="text-xs text-ember-300">{err}</p>{/if}
  {#if !canMic}
    <form
      onsubmit={(e) => {
        e.preventDefault()
        const v = (e.currentTarget as HTMLFormElement).querySelector('input')?.value ?? ''
        if (v.trim()) onsubmit(v.trim())
      }}
      class="flex gap-2"
    >
      <input
        placeholder="No mic here — type it instead"
        {...typingAttrs(language)}
        class="flex-1 rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
      />
      <button class="btn btn-primary px-3 py-2 text-sm" disabled={busy} data-enter-action>
        {#if busy}<Spinner size={14} label="Checking your answer" /> Checking…{:else}Check{/if}
      </button>
    </form>
  {/if}
</div>
