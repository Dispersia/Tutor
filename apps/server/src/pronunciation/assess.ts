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

/**
 * Runs one attempt through the speech gateway: ASR transcript + forced alignment
 * to the expected text (DESIGN §9.4). Wakes the sidecar if it's asleep.
 *
 * We deliberately do NOT bias the ASR toward the deck vocabulary. Whisper folds
 * hotwords into its initial prompt, and on a short take the decoder "continues"
 * that prompt instead of listening: a learner who says いる comes back as います,
 * a course word they never said. Pronunciation scoring is only honest if the
 * transcript reports what was actually said, so the decode is unbiased and the
 * forced aligner (given the expected text) is what anchors the attempt.
 */
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
