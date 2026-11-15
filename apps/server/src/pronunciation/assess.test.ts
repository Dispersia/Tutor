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

test('makeAssessor forwards the language and vocabulary hint to /v1/assess', async () => {
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
    const assess = makeAssessor(fakeDeps(), 'ja', 'なに,これ')
    const r = await assess(new Uint8Array([1, 2, 3]), 'なに')
    expect(r.transcript).toBe('なに')
    expect(calls[0]!.url).toContain('/v1/assess')
    expect(calls[0]!.form.get('language')).toBe('ja')
    expect(calls[0]!.form.get('text')).toBe('なに')
    expect(calls[0]!.form.get('hint')).toBe('なに,これ')
  } finally {
    globalThis.fetch = orig
  }
})
