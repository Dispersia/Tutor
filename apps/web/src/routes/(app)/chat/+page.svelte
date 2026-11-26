<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { api, jsonBody } from '#lib/api'
  import { drainSentences, streamChat } from '#lib/chat'
  import { Recorder, micSupported, MIN_CLIP_MS } from '#lib/recorder'
  import { activeDeckOf, loadActiveDeck } from '#lib/activeDeck.svelte'
  import { createSpeaker, stopAudio, transcribe, wakeSpeech, type Speaker } from '#lib/speech'
  import { accentStyle } from '#lib/theme'
  import { ACCENT } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'
  import SuggestedCard from '#lib/components/chat/SuggestedCard.svelte'
  import { typingAttrs } from '#lib/lang'
  import { autoGrow } from '#lib/grow'
  import type { ChatSession, Message } from '#lib/types'
  import { speechOpts } from '#lib/voices'
  import { cachedResource } from '#lib/resource.svelte'

  const threadPath = (id: string) => `/api/sessions/${id}`

  interface ChatSuggestion {
    deckId: string
    deckName: string
    targetLang: string
    card: { front: string; back: string; reading?: string }
  }

  const list = cachedResource<{ sessions: ChatSession[] }>('/api/sessions', { auto: false })
  const firstSession = list.data?.sessions[0]
  const thread = cachedResource<{ messages: Message[] }>(
    () => (firstSession ? threadPath(firstSession.id) : undefined),
    { auto: false },
  )
  const messages = $derived((thread.data?.messages ?? []).filter((m) => m.role !== 'system'))
  let sessionId = $state<string | null>(firstSession?.id ?? null)
  let input = $state('')
  let busy = $state(false)
  let ttsOn = $state(true)
  let recording = $state(false)
  let transcribing = $state(false)
  let error = $state('')
  let speaking = $state(false)
  let suggestion = $state<ChatSuggestion | null>(null)
  let savingCard = $state(false)
  let cardNote = $state('')
  let speaker: Speaker | null = null
  let stream: AbortController | null = null
  let touched = false

  const recorder = new Recorder()
  const lang = $derived(activeDeckOf()?.targetLang ?? undefined)
  const canMic = micSupported()

  onMount(async () => {
    if (ttsOn) void wakeSpeech().catch(() => {})
    void loadActiveDeck()
    try {
      await openLatest()
    } catch (e) {
      error = (e as Error).message
    }
  })

  onDestroy(() => {
    stream?.abort()
    recorder.dispose()
    speaker?.cancel()
    stopAudio()
  })

  async function openLatest() {
    const { sessions } = await list.load()
    const latest = sessions[0]
    if (touched) return
    if (latest) {
      sessionId = latest.id
      await loadMessages(latest.id)
      return
    }
    const s = await api<ChatSession>('/api/sessions', jsonBody({ kind: 'chat', lang }))
    if (!touched) sessionId = s.id
  }

  async function loadMessages(id: string) {
    follow(id)
    await thread.load()
    if (!touched) scrollDown()
  }

  function follow(id: string) {
    const path = threadPath(id)
    if (thread.path === path) return
    const shown = thread.data ?? { messages: [] }
    thread.open(path)
    thread.set(shown)
  }

  function patchMessage(id: string, patch: (m: Message) => Message) {
    thread.set({ messages: messages.map((m) => (m.id === id ? patch(m) : m)) })
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
    touched = true
    const { id, sp, sink } = beginReply(text)
    const ctl = (stream = new AbortController())
    try {
      const body = { sessionId: sessionId ?? undefined, text, role: 'conversation' }
      await streamChat(body, { onSession: sink.onSession, onDelta: sink.onDelta }, ctl.signal)
      sink.flush()
    } catch (e) {
      failReply(id, sp, e)
    } finally {
      busy = false
      if (!ctl.signal.aborted) await afterReply()
    }
  }

  async function afterReply() {
    await reloadMessages()
    void checkCard()
  }

  async function checkCard() {
    if (!sessionId) return
    suggestion = null
    cardNote = ''
    try {
      const res = await api<{ suggestion: ChatSuggestion | null }>(
        '/api/chat/card/suggest',
        jsonBody({ sessionId }),
      )
      suggestion = res.suggestion
    } catch {
      suggestion = null
    }
  }

  async function addSuggestedCard() {
    if (!suggestion || savingCard) return
    const s = suggestion
    savingCard = true
    try {
      await api(
        '/api/chat/card',
        jsonBody({ deckId: s.deckId, targetLang: s.targetLang, card: s.card }),
      )
      cardNote = `Added to ${s.deckName}.`
      suggestion = null
    } catch (e) {
      cardNote = (e as Error).message
    } finally {
      savingCard = false
    }
  }

  function beginReply(text: string) {
    stopAudio()
    speaker?.cancel()
    speaker = null
    suggestion = null
    cardNote = ''
    const reply = localMsg('assistant', '')
    thread.set({ messages: [...messages, localMsg('user', text), reply] })
    scrollDown()
    const sp = startSpeaking()
    return { id: reply.id, sp, sink: replySink(reply.id, sp) }
  }

  function failReply(id: string, sp: Speaker | null, e: unknown) {
    error = (e as Error).message
    patchMessage(id, (m) => ({ ...m, text: m.text || '(no reply)' }))
    sp?.cancel()
    if (speaker === sp) speaking = false
  }

  async function reloadMessages() {
    if (!sessionId) return
    follow(sessionId)
    await thread.refresh()
  }

  function startSpeaking(): Speaker | null {
    if (!ttsOn) return null
    const sp = createSpeaker(speechOpts(lang), (e) => (error = `Playback: ${e.message}`))
    speaker = sp
    speaking = true
    return sp
  }

  interface ReplySink {
    onSession: (id: string) => void
    onDelta: (text: string) => void
    flush: () => void
  }

  function replySink(id: string, sp: Speaker | null): ReplySink {
    let buf = ''
    return {
      onSession: (id) => (sessionId = id),
      onDelta: (d) => {
        buf = speakDelta(id, sp, buf, d)
      },
      flush: () => flushSpeech(sp, buf),
    }
  }

  function speakDelta(id: string, sp: Speaker | null, buf: string, d: string): string {
    patchMessage(id, (m) => ({ ...m, text: m.text + d }))
    scrollDown()
    if (!sp) return buf
    const next = buf + d
    const { sentences, rest } = drainSentences(next)
    for (const sentence of sentences) sp.push(sentence)
    return rest
  }

  function flushSpeech(sp: Speaker | null, buf: string): void {
    if (!sp) return
    if (buf.trim()) sp.push(buf)
    void sp.close().finally(() => {
      if (speaker === sp) speaking = false
    })
  }

  async function toggleRecord() {
    error = ''
    if (recording) await stopAndTranscribe()
    else await startRecording()
  }

  async function stopAndTranscribe() {
    recording = false
    const take = await recorder.stop()
    if (take.durationMs < MIN_CLIP_MS) {
      error = 'That was too quick — hold the mic and speak.'
      return
    }
    if (!take.blob) {
      error = "Didn't catch that — try again."
      return
    }
    transcribing = true
    try {
      await transcribeIntoInput(take.blob)
    } finally {
      transcribing = false
    }
  }

  async function transcribeIntoInput(blob: Blob) {
    try {
      const text = await transcribe(blob, lang)
      if (!text.trim()) {
        error = "Didn't catch that — try again."
        return
      }
      input = text.trim()
      await send()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function startRecording() {
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

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || e.repeat) return
    if (e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    void send()
  }
</script>

<div class="border-b border-ink-700 pt-4 pb-4 lg:mx-auto lg:max-w-3xl">
  <h1 class="display text-3xl text-ink-100">Talk to your Tutor</h1>
  <p class="sub mt-1.5">
    {lang ? lang.toUpperCase() : 'EN'} · replies are spoken
    {#if speaking}<span class="text-jade-400">· speaking…</span>{/if}
  </p>
</div>

<div class="space-y-3 pt-4 pb-20 lg:mx-auto lg:max-w-3xl">
  {#if messages.length === 0}
    <p class="panel panel-accent p-4 text-sm text-ink-300" style={accentStyle(ACCENT.azure)}>
      Say or type something in your target language to begin. Your Tutor answers out loud and keeps
      the whole history.
    </p>
  {/if}
  {#each messages as m (m.id)}
    <div class={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
      <div
        class="max-w-[85%] break-words rounded-[12px] px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap {m.role ===
        'user'
          ? 'bg-seal-400 text-ink-950'
          : 'border border-ink-700 bg-ink-900 text-ink-100'}"
      >
        {m.text}
        {#if m.role === 'assistant' && m.model}
          <div class="mt-1 text-xs text-ink-400">{m.model}</div>
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
  {#if suggestion}
    <SuggestedCard
      deckName={suggestion.deckName}
      front={suggestion.card.front}
      back={suggestion.card.back}
      reading={suggestion.card.reading}
      saving={savingCard}
      onAdd={addSuggestedCard}
      onDismiss={() => (suggestion = null)}
    />
  {/if}
  {#if cardNote}
    <p class="text-xs text-jade-400">{cardNote}</p>
  {/if}
</div>

{#if error}
  <div class="fixed inset-x-0 bottom-24 mx-auto max-w-md px-2 lg:bottom-6">
    <p class="banner justify-center text-center" style="--accent: {ACCENT.ember}" role="alert">
      {error}
    </p>
  </div>
{/if}

<div class="sticky bottom-0 z-10 mx-auto w-full max-w-2xl pb-2 lg:bottom-4 lg:max-w-3xl lg:pb-4">
  <div
    class="panel panel-accent flex items-end gap-2 p-2 transition-colors focus-within:border-seal-400"
    style={accentStyle(ACCENT.azure)}
  >
    <textarea
      bind:value={input}
      onkeydown={onKey}
      use:autoGrow={128}
      {...typingAttrs(lang)}
      rows="1"
      placeholder="Type…"
      class="max-h-32 flex-1 resize-none bg-transparent px-2 py-2 outline-none"
    ></textarea>

    <button
      onclick={() => (ttsOn = !ttsOn)}
      title={ttsOn ? 'Replies are spoken — tap to mute' : 'Replies are silent — tap to speak'}
      aria-label="Speak replies"
      aria-pressed={ttsOn}
      class="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] transition-colors {ttsOn
        ? 'bg-jade-400/12 text-jade-400'
        : 'text-ink-400 hover:bg-ink-800'}"
    >
      <Icon name={ttsOn ? 'sound' : 'mute'} size={18} />
    </button>

    {#if canMic}
      <button
        onclick={toggleRecord}
        title="Hold a conversation"
        aria-label="Record a message"
        aria-pressed={recording}
        class="grid h-11 w-11 place-items-center rounded-[10px] {recording
          ? 'recording bg-ember-500 text-ink-950'
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

    <button onclick={send} disabled={busy || !input.trim()} class="btn btn-primary px-4 py-2">
      Send
    </button>
  </div>
</div>
