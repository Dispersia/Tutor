import type { Context } from 'hono'
import type { App, AppEnv } from '../context'

async function proxyToSpeech(c: Context<AppEnv>, path: string): Promise<Response> {
  const sup = c.get('deps').supervisor
  await sup.ensure()
  sup.begin()
  try {
    const headers = new Headers()
    const ct = c.req.header('content-type')
    if (ct) headers.set('content-type', ct)
    const body =
      c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : await c.req.arrayBuffer()
    const res = await fetch(sup.url + path, { method: c.req.method, headers, body })
    const out: Record<string, string> = {}
    const oct = res.headers.get('content-type')
    if (oct) out['content-type'] = oct
    const sr = res.headers.get('x-sample-rate')
    if (sr) out['x-sample-rate'] = sr
    return new Response(res.body, { status: res.status, headers: out })
  } finally {
    sup.end()
  }
}

export function registerSpeech(app: App) {
  // Proxy the speech gateway through the app so the client only ever talks to us,
  // and so every call keeps the sidecar awake (DESIGN §8).
  app.get('/api/speech/health', async (c) => c.json(await c.get('deps').supervisor.status()))

  app.post('/api/speech/wake', async (c) => {
    await c.get('deps').supervisor.ensure()
    return c.json(await c.get('deps').supervisor.status())
  })

  app.post('/api/speech/unload', async (c) => {
    const sup = c.get('deps').supervisor
    let result: unknown = null
    try {
      const r = await fetch(`${sup.url}/admin/unload`, { method: 'POST' })
      result = await r.json()
    } catch {
      // gateway may already be down
    }
    await sup.stop()
    return c.json({ ok: true, result })
  })

  app.post('/api/speech/tts', (c) => proxyToSpeech(c, '/v1/tts'))
  app.post('/api/speech/asr', (c) => proxyToSpeech(c, '/v1/asr'))
  app.post('/api/speech/align', (c) => proxyToSpeech(c, '/v1/align'))
}
