import { Hono } from 'hono'
import { logger } from 'hono/logger'
import type { App, AppEnv, Deps } from './context'
import { publicUser } from './db/repo'
import { registerAuth, currentUser } from './routes/auth'
import { registerAudio } from './routes/audio'
import { registerChat } from './routes/chat'
import { registerCombat } from './routes/combat'
import { registerCurriculum } from './routes/curriculum'
import { registerDecks } from './routes/decks'
import { registerHealth } from './routes/health'
import { registerModels } from './routes/models'
import { registerPractice } from './routes/practice'
import { registerPush } from './routes/push'
import { registerSessions } from './routes/sessions'
import { registerSettings } from './routes/settings'
import { registerSkills } from './routes/skills'
import { registerSpeech } from './routes/speech'
import { registerStats } from './routes/stats'
import { registerStatic } from './static'

/** Endpoints reachable without a session. */
const PUBLIC_PREFIXES = ['/api/health', '/api/auth', '/api/models']

function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))
}

export function createApp(deps: Deps, opts: { staticDir: string; log?: boolean }): App {
  const app = new Hono<AppEnv>()
  if (opts.log !== false) app.use('*', logger())

  app.use('*', async (c, next) => {
    c.set('deps', deps)
    c.set('user', null)
    await next()
  })

  // Multi-user gate: everything under /api (except the public list) needs a session.
  app.use('/api/*', async (c, next) => {
    if (isPublic(c.req.path)) return next()
    const user = currentUser(c)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    c.set('user', publicUser(user))
    await next()
  })

  registerHealth(app)
  registerAuth(app)
  registerModels(app)
  registerSettings(app)
  registerDecks(app)
  registerPractice(app)
  registerAudio(app)
  registerCurriculum(app)
  registerSkills(app)
  registerCombat(app)
  registerStats(app)
  registerChat(app)
  registerSessions(app)
  registerSpeech(app)
  registerPush(app)
  registerStatic(app, opts.staticDir)

  app.onError((err, c) => {
    console.error('[error]', err)
    return c.json({ error: err.message }, 500)
  })

  return app
}
