import { Hono } from 'hono'
import { GatewaySpeechProvider } from '@tutor/speech'

const app = new Hono()
const speech = new GatewaySpeechProvider({
  baseUrl: process.env.TUTOR_SPEECH_URL ?? 'http://127.0.0.1:4319',
})

app.get('/', (c) => c.text('tutor api — see /api/health'))

app.get('/api/health', (c) =>
  c.json({ ok: true, name: 'tutor', version: '0.0.0', phase: 0 }),
)

// Best-effort view of the speech gateway. Returns { ready: false } when the
// sidecar is asleep — the supervisor (Phase 2) is what starts/stops it.
app.get('/api/speech/health', async (c) => {
  try {
    return c.json(await speech.health())
  } catch {
    return c.json({ ready: false, models: [], lastActivity: 0, asleep: true })
  }
})

const port = Number(process.env.TUTOR_PORT ?? 4318)

export default { port, fetch: app.fetch }

if (import.meta.main) {
  console.log(`tutor api listening on http://127.0.0.1:${port}`)
}
