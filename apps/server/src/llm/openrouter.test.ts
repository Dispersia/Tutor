import { expect, test } from 'bun:test'
import { OpenRouter, parseSseData } from './openrouter'

test('parseSseData handles deltas, usage, done and garbage', () => {
  expect(parseSseData('[DONE]')).toEqual({ type: 'done' })
  expect(parseSseData('{"choices":[{"delta":{"content":"x"}}]}')).toEqual({
    type: 'delta',
    text: 'x',
  })
  expect(parseSseData('not json')).toBeNull()
  expect(parseSseData('{"choices":[{"delta":{}}]}')).toBeNull()
  expect(
    parseSseData('{"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3,"cost":0.5}}'),
  ).toEqual({
    type: 'usage',
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, costUsd: 0.5 },
  })
})

function streamResponse(sse: string): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(sse))
      c.close()
    },
  })
  return new Response(body, { status: 200 })
}

test('streamChat yields deltas, usage then done; listModels maps + caches', async () => {
  const orig = globalThis.fetch
  let modelCalls = 0
  const fetchMock = (async (url: string | URL) => {
    const u = String(url)
    if (u.includes('/models')) {
      modelCalls++
      return Response.json({
        data: [
          {
            id: 'a',
            name: 'A',
            context_length: 100,
            pricing: { prompt: '0.000002', completion: '0.000004' },
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          },
        ],
      })
    }
    return streamResponse(
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
        'data: {"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7,"cost":0.0001}}\n\n' +
        'data: [DONE]\n\n',
    )
  }) as unknown as typeof fetch
  globalThis.fetch = fetchMock

  const or = new OpenRouter('test-key', 'http://stub')
  const models = await or.listModels()
  expect(models[0]!.id).toBe('a')
  expect(models[0]!.promptPricePerM).toBeCloseTo(2)
  expect(models[0]!.completionPricePerM).toBeCloseTo(4)
  await or.listModels()
  expect(modelCalls).toBe(1)

  const events: { type: string; text?: string }[] = []
  let usage = { totalTokens: 0 }
  for await (const ev of or.streamChat({
    model: 'a',
    messages: [{ role: 'user', content: 'hi' }],
  })) {
    events.push(ev)
    if (ev.type === 'usage') usage = ev.usage
  }
  expect(
    events
      .filter((e) => e.type === 'delta')
      .map((e) => e.text)
      .join(''),
  ).toBe('你好')
  expect(events.at(-1)).toEqual({ type: 'done' })
  expect(usage.totalTokens).toBe(7)

  globalThis.fetch = orig
})

test('chatJSON parses structured output', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = (async () =>
    Response.json({
      choices: [{ message: { content: '{"score":88}' } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    })) as unknown as typeof fetch

  const or = new OpenRouter('k', 'http://stub')
  const { json } = await or.chatJSON<{ score: number }>({
    model: 'm',
    messages: [{ role: 'user', content: 'grade' }],
    schema: { type: 'object', properties: { score: { type: 'number' } } },
  })
  expect(json.score).toBe(88)

  globalThis.fetch = orig
})

test('listModels({user:true}) uses /models/user and requires a key', async () => {
  const orig = globalThis.fetch
  const paths: string[] = []
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url)
    paths.push(new URL(u).pathname)
    return Response.json({
      data: [{ id: 'user/only', name: 'User Only', pricing: {}, architecture: {} }],
    })
  }) as unknown as typeof fetch

  const or = new OpenRouter('test-key', 'http://stub')
  const models = await or.listModels({ user: true })
  expect(paths).toEqual(['/models/user'])
  expect(models[0]!.id).toBe('user/only')

  expect(new OpenRouter(undefined, 'http://stub').listModels({ user: true })).rejects.toThrow(
    'OPENROUTER_API_KEY is not set',
  )

  globalThis.fetch = orig
})
