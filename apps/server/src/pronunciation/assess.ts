import type { AssessResult } from '@tutor/core'
import type { Deps } from '../context'
import { withGateway } from '../speech/gateway'
import type { AssessFn } from './types'

export type { AssessFn }

function toWav(audio: Uint8Array): Blob {
  const buf = audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength,
  ) as ArrayBuffer
  return new Blob([buf], { type: 'audio/wav' })
}

export function makeAssessor(deps: Deps, language?: string): AssessFn {
  return (audio, expected) =>
    withGateway(deps.supervisor, async (url) => {
      const form = new FormData()
      form.set('file', toWav(audio), 'clip.wav')
      form.set('text', expected)
      if (language) form.set('language', language)
      const res = await fetch(`${url}/v1/assess`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`assess failed: ${await res.text().catch(() => res.status)}`)
      return (await res.json()) as AssessResult
    })
}
