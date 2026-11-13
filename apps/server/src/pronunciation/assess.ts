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
 */
export function makeAssessor(deps: Deps, language?: string): AssessFn {
  return async (audio, expected) => {
    const sup = deps.supervisor
    await sup.ensure()
    sup.begin()
    try {
      const form = new FormData()
      form.set('file', toWav(audio), 'clip.wav')
      form.set('text', expected)
      if (language) form.set('language', language)
      const res = await fetch(`${sup.url}/v1/assess`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`assess failed: ${await res.text().catch(() => res.status)}`)
      return (await res.json()) as AssessResult
    } finally {
      sup.end()
    }
  }
}
