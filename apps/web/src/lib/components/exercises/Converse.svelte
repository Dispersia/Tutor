<script lang="ts">
  import type { Instance } from '#lib/exercises'
  import { typingAttrs } from '#lib/lang'
  import type { PitchContour } from '#lib/types'
  import { Recorder, micSupported, MIN_CLIP_MS } from '#lib/recorder'
  import { stopAudio, transcribe } from '#lib/speech'
  import Word from '../Word.svelte'
  import Icon from '../Icon.svelte'
  import Spinner from '../Spinner.svelte'

  let {
    instance,
    busy = false,
    onsubmit,
  }: { instance: Instance; busy?: boolean; onsubmit: (answer: string) => void } = $props()

  const recorder = new Recorder()
  const language = $derived((instance.data.language as string) ?? undefined)
  const answerLang = $derived((instance.data.answerLang as string) ?? language)
  const topic = $derived((instance.data.topic as string) ?? '')
  const reading = $derived((instance.data.reading as string) ?? '')
  const lang = $derived((instance.data.readingLang as string) ?? '')
  const furigana = $derived(instance.data.furigana as { base: string; ruby?: string }[] | undefined)
  const pitch = $derived(instance.data.pitch as PitchContour | undefined)
  const canMic = micSupported()

  let answer = $state('')
  let recording = $state(false)
  let working = $state(false)
  let err = $state('')

  function send() {
    if (answer.trim() && !busy) onsubmit(answer.trim())
  }

  function submit(e: SubmitEvent) {
    e.preventDefault()
    send()
  }

  /**
   * Enter sends, Shift+Enter adds a newline. `isComposing` (and keyCode 229) guard
   * the Enter that confirms an IME candidate — critical when typing Japanese.
   */
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || e.repeat) return
    if (e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    send()
  }

  async function record() {
    err = ''
    if (recording) {
      recording = false
      const blob = await recorder.stop()
      if (recorder.elapsedMs < MIN_CLIP_MS) {
        err = 'That was too quick — hold the mic and speak.'
        return
      }
      working = true
      try {
        const text = await transcribe(blob, language)
        if (text.trim()) answer = text.trim()
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

<form onsubmit={submit} class="space-y-4">
  <p class="text-lg leading-snug">{instance.prompt}</p>
  {#if topic}
    <div class="flex justify-center py-2">
      <span class="cell min-h-[5rem] min-w-[5rem] px-6 py-4"
        ><Word word={topic} {reading} {lang} {furigana} {pitch} size="md" /></span
      >
    </div>
  {/if}
  <textarea
    bind:value={answer}
    onkeydown={onKeydown}
    {...typingAttrs(answerLang)}
    rows="2"
    class="w-full rounded-md border border-ink-600 bg-ink-900 px-4 py-3 outline-none focus:border-seal-400"
    placeholder="Write or say a sentence…"
  ></textarea>
  <div class="flex gap-2">
    {#if canMic}
      <button
        type="button"
        onclick={record}
        disabled={busy || working}
        class="btn px-4 py-3 {recording ? 'recording bg-red-600 text-white' : 'btn-ghost'}"
      >
        {#if working}<Spinner
            size={16}
            label="Transcribing your voice"
            cls="my-0.5"
          />{:else if recording}■{:else}<Icon name="mic" size={18} />{/if}
      </button>
    {/if}
    <button
      type="submit"
      disabled={busy || !answer.trim()}
      data-enter-action
      class="btn btn-primary flex-1 py-3"
    >
      {#if busy}<Spinner size={15} label="Sending your answer" /> Sending…{:else}Send{/if}
    </button>
  </div>
  {#if err}<p class="text-xs text-ember-300">{err}</p>{/if}
</form>
