import type { Context } from 'hono'
import type { App, AppEnv } from '../context'
import { imeCandidates } from '../ime/candidates'
import { jsonBody, str } from './body'
import { fail } from './errors'

const MAX_KEYS = 80

async function candidates(c: Context<AppEnv>) {
  const body = await jsonBody(c)
  const lang = str(body, 'lang')
  const keys = str(body, 'keys') ?? ''
  if (!lang) return fail(c, 400, 'lang required')
  if (keys.length > MAX_KEYS) return fail(c, 400, 'keys too long')
  return c.json({ candidates: imeCandidates(lang, keys) })
}

export function registerIme(app: App) {
  app.post('/api/ime/candidates', candidates)
}
