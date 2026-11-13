<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '#lib/api'
  import { splitSentences, streamChat } from '#lib/chat'
  import { Recorder, micSupported } from '#lib/recorder'
  import { session } from '#lib/session.svelte'
  import { speak, stopAudio, transcribe } from '#lib/speech'
  import { accentStyle } from '#lib/theme'
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

  const recorder = new Recorder()
  const lang = $derived(session.user?.targetLang ?? undefined)
  const canMic = micSupported()

  onMount(async () => {
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
    messages = [...messages, localMsg('user', text), localMsg('assistant', '')]
    const idx = messages.length - 1
    scrollDown()
    let full = ''
    try {
      await streamChat(
        { sessionId: sessionId ?? undefined, text, role: 'conversation' },
        {
          onSession: (id) => (sessionId = id),
          onDelta: (d) => {
            full += d
            messages[idx] = { ...messages[idx], text: full }
            scrollDown()
          },
        },
      )
      if (ttsOn && full) void speakReply(full)
    } catch (e) {
      error = (e as Error).message
      messages[idx] = { ...messages[idx], text: full || '(no reply)' }
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

  async function speakReply(text: string) {
    speaking = true
    try {
      const voice = voiceFor(lang)
      for (const sentence of splitSentences(text)) {
        await speak(sentence, { voice, language: lang, mode: 'preset' })
      }
    } catch (e) {
      error = `Playback: ${(e as Error).message}`
    } finally {
      speaking = false
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
      try {
        await recorder.start()
        recording = true
      } catch (e) {
        error = `Microphone unavailable (needs HTTPS on the phone). ${(e as Error).message}`
      }
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }
</script>

<div class="pt-5">
  <p class="eyebrow">Conversation</p>
  <h1 class="display text-2xl text-gold-200">Talk to your tutor</h1>
  <p class="text-xs text-ink-400">
    {lang ? lang.toUpperCase() : 'EN'} · replies are spoken
    {#if speaking}<span class="text-emerald-400">· speaking…</span>{/if}
  </p>
</div>

<div class="space-y-3 pt-4 pb-28">
  {#if messages.length === 0}
    <p class="panel panel-accent p-4 text-sm text-ink-300" style={accentStyle('#4fb0e8')}>
      Say or type something in your target language to begin. Your tutor answers out loud and keeps
      the whole history.
    </p>
  {/if}
  {#each messages as m (m.id)}
    <div class={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
      <div
        class="max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap {m.role ===
        'user'
          ? 'bg-emerald-600/90 text-white'
          : 'border border-ink-700 bg-ink-900 text-white'}"
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
      <div class="panel px-4 py-2.5 text-ink-400">…</div>
    </div>
  {/if}
</div>

{#if error}
  <div
    class="fixed inset-x-0 bottom-24 mx-auto max-w-md rounded-xl bg-red-950/90 px-3 py-2 text-center text-sm text-red-200"
  >
    {error}
  </div>
{/if}

<div class="sticky bottom-16 z-10 mx-auto w-full max-w-2xl pb-3">
  <div class="panel panel-accent flex items-end gap-2 p-2" style={accentStyle('#4fb0e8')}>
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
      class="rounded-xl px-2 py-2 text-lg {ttsOn ? 'text-emerald-400' : 'text-ink-500'}"
    >
      {ttsOn ? '🔊' : '🔇'}
    </button>

    {#if canMic}
      <button
        onclick={toggleRecord}
        title="Hold a conversation"
        class="rounded-xl px-3 py-2 text-lg {recording
          ? 'recording bg-red-600'
          : transcribing
            ? 'bg-ink-700'
            : 'bg-ink-800'}"
      >
        {transcribing ? '…' : recording ? '●' : '🎤'}
      </button>
    {/if}

    <button
      onclick={send}
      disabled={busy || !input.trim()}
      class="rounded-xl bg-emerald-500 px-4 py-2 font-medium text-black disabled:opacity-40"
    >
      Send
    </button>
  </div>
</div>
