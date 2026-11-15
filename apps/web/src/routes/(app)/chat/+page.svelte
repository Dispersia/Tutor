<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '#lib/api'
  import { drainSentences, streamChat } from '#lib/chat'
  import { Recorder, micSupported } from '#lib/recorder'
  import { session } from '#lib/session.svelte'
  import { createSpeaker, stopAudio, transcribe, wakeSpeech, type Speaker } from '#lib/speech'
  import { accentStyle } from '#lib/theme'
  import { ACCENT } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import type { ChatSession, Message } from '#lib/types'
  import { voiceFor } from '#lib/voices'

  let messages = $state<Message[]>([])
  let sessionId = $state<string | null>(null)
  let input = $state('')
  let busy = $state(false)
  let ttsOn = $state(true)
  let recording = $state(false)
  let transcribing = $state(false)
  let error = $state('')
  let speaking = $state(false)
  let speaker: Speaker | null = null

  const recorder = new Recorder()
  const lang = $derived(session.user?.targetLang ?? undefined)
  const canMic = micSupported()

  onMount(async () => {
    // Replies are spoken here, so pre-warm the voice models on entry: the first
    // reply should not also pay the 2-6 s model load (DESIGN §8.1).
    if (ttsOn) void wakeSpeech().catch(() => {})
    try {
      const { sessions } = await api<{ sessions: ChatSession[] }>('/api/sessions')
      const latest = sessions[0]
      if (latest) {
        sessionId = latest.id
        await loadMessages(latest.id)
      } else {
        const s = await api<ChatSession>('/api/sessions', {
          method: 'POST',
          body: JSON.stringify({ kind: 'chat', lang }),
        })
        sessionId = s.id
      }
    } catch (e) {
      error = (e as Error).message
    }
  })

  async function loadMessages(id: string) {
    const r = await api<{ messages: Message[] }>(`/api/sessions/${id}`)
    messages = r.messages.filter((m) => m.role !== 'system')
    scrollDown()
  }

  function scrollDown() {
    queueMicrotask(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))
  }

  function localMsg(role: Message['role'], text: string): Message {
    return {
      id: crypto.randomUUID(),
      sessionId: sessionId ?? '',
      role,
      text,
      model: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      createdAt: Date.now(),
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    error = ''
    input = ''
    busy = true
    stopAudio()
    speaker?.cancel()
    speaker = null
    messages = [...messages, localMsg('user', text), localMsg('assistant', '')]
    const idx = messages.length - 1
    scrollDown()
    let full = ''
    let speakBuf = ''
    let sp: Speaker | null = null
    try {
      // Speak as the reply streams: push each sentence to the speaker the moment
      // it is complete, so audio starts before the model has finished writing.
      if (ttsOn) {
        sp = createSpeaker(
          { voice: voiceFor(lang), language: lang, mode: 'preset' },
          (e) => (error = `Playback: ${e.message}`),
        )
        speaker = sp
        speaking = true
      }
      await streamChat(
        { sessionId: sessionId ?? undefined, text, role: 'conversation' },
        {
          onSession: (id) => (sessionId = id),
          onDelta: (d) => {
            full += d
            messages[idx] = { ...messages[idx], text: full }
            scrollDown()
            if (sp) {
              speakBuf += d
              const { sentences, rest } = drainSentences(speakBuf)
              speakBuf = rest
              for (const sentence of sentences) sp.push(sentence)
            }
          },
        },
      )
      if (sp) {
        if (speakBuf.trim()) sp.push(speakBuf)
        const done = sp
        void done.close().finally(() => {
          if (speaker === done) speaking = false
        })
      }
    } catch (e) {
      error = (e as Error).message
      messages[idx] = { ...messages[idx], text: full || '(no reply)' }
      sp?.cancel()
      if (speaker === sp) speaking = false
    } finally {
      busy = false
      if (sessionId) {
        try {
          messages = (
            await api<{ messages: Message[] }>(`/api/sessions/${sessionId}`)
          ).messages.filter((m) => m.role !== 'system')
        } catch {
          /* keep optimistic */
        }
      }
    }
  }

  async function toggleRecord() {
    error = ''
    if (recording) {
      recording = false
      const blob = await recorder.stop()
      transcribing = true
      try {
        const text = await transcribe(blob, lang)
        if (text.trim()) {
          input = text.trim()
          await send()
        } else {
          error = "Didn't catch that — try again."
        }
      } catch (e) {
        error = (e as Error).message
      } finally {
        transcribing = false
      }
    } else {
      stopAudio()
      speaker?.cancel()
      speaker = null
      speaking = false
      try {
        await recorder.start()
        recording = true
      } catch (e) {
        error = `Microphone unavailable (needs HTTPS on the phone). ${(e as Error).message}`
      }
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || e.repeat) return
    // Don't send while an IME is confirming a candidate (typing Japanese).
    if (e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    void send()
  }
</script>

<div class="border-b border-ink-700 pt-5 pb-4">
  <h1 class="display text-3xl text-ink-100">Talk to your tutor</h1>
  <p class="mt-1 text-xs text-ink-400">
    {lang ? lang.toUpperCase() : 'EN'} · replies are spoken
    {#if speaking}<span class="text-jade-400">· speaking…</span>{/if}
  </p>
</div>

<div class="space-y-3 pt-4 pb-28">
  {#if messages.length === 0}
    <p class="panel panel-accent p-4 text-sm text-ink-300" style={accentStyle(ACCENT.azure)}>
      Say or type something in your target language to begin. Your tutor answers out loud and keeps
      the whole history.
    </p>
  {/if}
  {#each messages as m (m.id)}
    <div class={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
      <div
        class="max-w-[85%] rounded-lg px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap {m.role ===
        'user'
          ? 'bg-seal-500/90 text-white'
          : 'border border-ink-700 bg-ink-900 text-ink-100'}"
      >
        {m.text}
        {#if m.role === 'assistant' && m.model}
          <div class="mt-1 text-[10px] text-ink-400">{m.model}</div>
        {/if}
      </div>
    </div>
  {/each}
  {#if busy && messages.at(-1)?.text === ''}
    <div class="flex justify-start">
      <div class="panel flex items-center gap-2 px-4 py-2.5 text-ink-400">
        <Spinner size={14} label={speaking ? 'Tutor is speaking' : 'Tutor is thinking'} />
        <span class="text-xs">{speaking ? 'Speaking…' : 'Thinking…'}</span>
      </div>
    </div>
  {/if}
</div>

{#if error}
  <div
    class="fixed inset-x-0 bottom-24 mx-auto max-w-md rounded-md bg-ember-950 px-3 py-2 text-center text-sm text-ember-300"
  >
    {error}
  </div>
{/if}

<div class="sticky bottom-16 z-10 mx-auto w-full max-w-2xl pb-3">
  <div class="panel panel-accent flex items-end gap-2 p-2" style={accentStyle(ACCENT.azure)}>
    <textarea
      bind:value={input}
      onkeydown={onKey}
      rows="1"
      placeholder="Type…"
      class="max-h-32 flex-1 resize-none bg-transparent px-2 py-2 outline-none"
    ></textarea>

    <button
      onclick={() => (ttsOn = !ttsOn)}
      title="Speak replies"
      class="px-2 py-2 {ttsOn ? 'text-jade-400' : 'text-ink-500'}"
    >
      <Icon name={ttsOn ? 'sound' : 'mute'} size={18} />
    </button>

    {#if canMic}
      <button
        onclick={toggleRecord}
        title="Hold a conversation"
        class="rounded-[4px] px-3 py-2 {recording
          ? 'recording bg-red-600 text-white'
          : transcribing
            ? 'bg-ink-700'
            : 'bg-ink-800'}"
      >
        {#if transcribing}<Spinner
            size={16}
            label="Transcribing your voice"
            cls="my-0.5"
          />{:else if recording}■{:else}<Icon name="mic" size={18} />{/if}
      </button>
    {/if}

    <button
      onclick={send}
      disabled={busy || !input.trim()}
      class="btn btn-primary px-4 py-2 disabled:opacity-40"
    >
      Send
    </button>
  </div>
</div>
