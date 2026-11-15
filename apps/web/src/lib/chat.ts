/** SSE chat streaming against POST /api/chat. */

import { apiPath } from './paths'

export interface StreamCallbacks {
  onSession?: (id: string) => void
  onDelta: (text: string) => void
  onUsage?: (usage: { totalTokens: number; costUsd: number }) => void
  onDone?: () => void
}

export async function streamChat(
  body: { sessionId?: string; text?: string; role?: string },
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(apiPath('/api/chat'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    let msg = text
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? text
    } catch {
      // keep raw
    }
    throw new Error(msg || `chat failed (${res.status})`)
  }

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const { event, data } = parseBlock(block)
      if (!event) continue
      if (event === 'session') cb.onSession?.(data)
      else if (event === 'delta') cb.onDelta(data)
      else if (event === 'usage') {
        try {
          cb.onUsage?.(JSON.parse(data) as { totalTokens: number; costUsd: number })
        } catch {
          // ignore
        }
      } else if (event === 'error') throw new Error(data)
      else if (event === 'done') cb.onDone?.()
    }
  }
}

function parseBlock(block: string): { event: string; data: string } {
  let event = ''
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  return { event, data: dataLines.join('\n') }
}

/** Splits text into sentence-ish chunks so TTS can start before the whole reply. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?。！？\n]+[.!?。！？]?/g) ?? [text]
  return parts.map((p) => p.trim()).filter(Boolean)
}

const SENTENCE_END = /[.!?。！？\n]/

/**
 * Streaming splitter: pulls every complete sentence off the front of the buffer
 * and returns the trailing fragment to carry into the next delta, so TTS can
 * start on sentence 1 while the model is still writing sentence 3.
 */
export function drainSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = []
  let start = 0
  for (let i = 0; i < buffer.length; i++) {
    if (SENTENCE_END.test(buffer[i]!)) {
      const s = buffer.slice(start, i + 1).trim()
      if (s) sentences.push(s)
      start = i + 1
    }
  }
  return { sentences, rest: buffer.slice(start) }
}
