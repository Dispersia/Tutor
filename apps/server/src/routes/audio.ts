/**
 * Pre-recorded card audio (docs/DESIGN.md §9.2 / §11.1).
 *
 * `GET /api/cards/:id/audio` streams one recorded voice for the card's target
 * text. It is a plain file stream: the clip was recorded when the card was made
 * (or is synthesized once, on demand, and cached). A `variant` query picks a
 * specific voice; without one each play gets a random voice from the set.
 */

import { getCard, listCards, setSetting } from '../db/repo'
import type { App, AppEnv } from '../context'
import { AUDIO_BACKFILL_KEY, variantVoice } from '../audio/service'
import type { Context } from 'hono'

async function serveCardAudio(c: Context<AppEnv>, cardId: string): Promise<Response> {
  const deps = c.get('deps')
  const user = c.get('user')!
  const audio = deps.audio
  if (!audio) return c.json({ error: 'audio unavailable' }, 503)

  const card = getCard(deps.db, cardId, user.id)
  if (!card) return c.json({ error: 'not found' }, 404)

  const voice = variantVoice(c.req.query('variant') ?? c.req.query('v'))
  try {
    let bytes = audio.clip(card.back, voice.id)
    if (!bytes) {
      // Not pre-recorded yet (a card made before the recording finished, or an
      // older deck): synth this one voice now and keep it for every later play.
      await audio.ensureVoice(card.back, card.targetLang, user.id, voice.id)
      bytes = audio.clip(card.back, voice.id)
    }
    if (!bytes) return c.json({ error: 'audio generation failed' }, 502)
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'audio/wav',
        'content-length': String(bytes.length),
        // The URL is stable but the voice is random per play, so never cache it.
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
}

export function registerAudio(app: App) {
  app.get('/api/cards/:id/audio', (c) => serveCardAudio(c, c.req.param('id')))

  /** How the background recorder is doing (pending clips, stored, failures). */
  app.get('/api/audio/status', (c) => {
    const audio = c.get('deps').audio
    return c.json(audio?.status() ?? { pending: 0, running: false, recorded: 0, failed: 0, voices: 0 })
  })

  /**
   * Queue every card the user owns that is missing clips. Returns at once —
   * recording happens in the background (one clip at a time, gateway stays
   * warm). Re-running it later resumes wherever it stopped.
   */
  app.post('/api/audio/backfill', (c) => {
    const deps = c.get('deps')
    const user = c.get('user')!
    const audio = deps.audio
    if (!audio) return c.json({ error: 'audio unavailable' }, 503)
    // Remember that the library should be fully recorded: a restart resumes it.
    setSetting(deps.db, AUDIO_BACKFILL_KEY, '1')
    const queued = audio.enqueueUser(user.id)
    return c.json({ queued, cards: listCards(deps.db, user.id).length, ...audio.status() }, 202)
  })

  /** Stops a running backfill: drops everything still queued and clears the
   * resume flag, so a restart does not start it again. */
  app.post('/api/audio/cancel', (c) => {
    const deps = c.get('deps')
    const audio = deps.audio
    if (!audio) return c.json({ error: 'audio unavailable' }, 503)
    setSetting(deps.db, AUDIO_BACKFILL_KEY, '0')
    const cancelled = audio.cancel()
    return c.json({ cancelled, ...audio.status() })
  })
}
