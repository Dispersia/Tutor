import type { AssessResult } from '@tutor/core'
import type { Deps } from '../context'

export type AssessFn = (audio: Uint8Array, expected: string) => Promise<AssessResult>

function toWav(audio: Uint8Array): Blob {
  const buf = audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength,
  ) as ArrayBuffer
  return new Blob([buf], { type: 'audio/wav' })
}

/**
 * Runs one attempt through the speech gateway: ASR transcript + forced alignment
 * to the expected text (DESIGN §9.4). Wakes the sidecar if it's asleep.
 *
 * `hint` biases the ASR toward the vocabulary in play (a comma-separated word
 * list → Qwen3-ASR hotwords), so a half-heard course word is not replaced by an
 * unrelated one. It is context, not the answer: the aligner still scores what
 * was actually said.
 */
export function makeAssessor(deps: Deps, language?: string, hint?: string): AssessFn {
  return async (audio, expected) => {
    const sup = deps.supervisor
    await sup.ensure()
    sup.begin()
    try {
      const form = new FormData()
      form.set('file', toWav(audio), 'clip.wav')
      form.set('text', expected)
      if (language) form.set('language', language)
      if (hint) form.set('hint', hint)
      const res = await fetch(`${sup.url}/v1/assess`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`assess failed: ${await res.text().catch(() => res.status)}`)
      return (await res.json()) as AssessResult
    } finally {
      sup.end()
    }
  }
}
