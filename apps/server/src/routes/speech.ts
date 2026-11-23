import type { Context } from 'hono'
import type { App, AppEnv } from '../context'
import { withGateway } from '../speech/gateway'
import { adminOnly } from './guards'

async function proxyToSpeech(c: Context<AppEnv>, path: string): Promise<Response> {
  const body =
    c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : await c.req.arrayBuffer()
  return withGateway(c.get('deps').supervisor, async (url) => {
    const res = await fetch(url + path, {
      method: c.req.method,
      headers: forwardedHeaders(c),
      body,
    })
    return new Response(res.body, { status: res.status, headers: responseHeaders(res) })
  })
}

function forwardedHeaders(c: Context<AppEnv>): Headers {
  const headers = new Headers()
  const ct = c.req.header('content-type')
  if (ct) headers.set('content-type', ct)
  return headers
}

/** Only the response headers the client actually needs. */
function responseHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {}
  const type = res.headers.get('content-type')
  if (type) out['content-type'] = type
  const rate = res.headers.get('x-sample-rate')
  if (rate) out['x-sample-rate'] = rate
  return out
}

export function registerSpeech(app: App) {
  // Proxy the speech gateway through the app so the client only ever talks to us,
  // and so every call keeps the sidecar awake (DESIGN §8).
  app.get('/api/speech/health', (c) => healthHandler(c))
  app.post('/api/speech/wake', (c) => wakeHandler(c))
  app.post('/api/speech/unload', (c) => unloadHandler(c))
  app.post('/api/speech/tts', (c) => proxyToSpeech(c, '/v1/tts'))
  app.post('/api/speech/asr', (c) => proxyToSpeech(c, '/v1/asr'))
  app.post('/api/speech/align', (c) => proxyToSpeech(c, '/v1/align'))
  app.post('/api/speech/assess', (c) => proxyToSpeech(c, '/v1/assess'))
}

async function healthHandler(c: Context<AppEnv>) {
  return c.json(await c.get('deps').supervisor.status())
}

async function wakeHandler(c: Context<AppEnv>) {
  // Load the voice models too, not just the process: a healthy gateway with no
  // models resident still pays the load cost on the first play/record.
  await c.get('deps').supervisor.warm()
  return c.json(await c.get('deps').supervisor.status())
}

/** Admin only: the gateway is shared, so stopping it cuts off every member mid-use. */
async function unloadHandler(c: Context<AppEnv>) {
  const denied = adminOnly(c)
  if (denied) return denied
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
}
