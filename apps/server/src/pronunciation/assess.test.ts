import { expect, test } from 'bun:test'
import type { Deps } from '../context'
import { makeAssessor } from './assess'

function fakeDeps(): Deps {
  return {
    supervisor: {
      url: 'http://127.0.0.1:4319',
      ensure: async () => {},
      begin: () => {},
      end: () => {},
    },
  } as unknown as Deps
}

test('makeAssessor sends the language and expected text, without a hotword hint', async () => {
  const calls: { url: string; form: FormData }[] = []
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), form: init.body as FormData })
    return new Response(JSON.stringify({ transcript: 'なに', items: [], duration: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  try {
    const assess = makeAssessor(fakeDeps(), 'ja')
    const r = await assess(new Uint8Array([1, 2, 3]), 'なに')
    expect(r.transcript).toBe('なに')
    expect(calls[0]!.url).toContain('/v1/assess')
    expect(calls[0]!.form.get('language')).toBe('ja')
    expect(calls[0]!.form.get('text')).toBe('なに')
    // The deck vocabulary must never reach the decoder as hotwords: Whisper would
    // read it back into the transcript on a short attempt.
    expect(calls[0]!.form.get('hint')).toBeNull()
  } finally {
    globalThis.fetch = orig
  }
})
