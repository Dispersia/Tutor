import { Hono } from 'hono'
import { logger } from 'hono/logger'
import type { App, AppEnv, Deps } from './context'
import { registerChat } from './routes/chat'
import { registerHealth } from './routes/health'
import { registerModels } from './routes/models'
import { registerSessions } from './routes/sessions'
import { registerSettings } from './routes/settings'
import { registerSpeech } from './routes/speech'
import { registerStatic } from './static'

export function createApp(deps: Deps, opts: { staticDir: string; log?: boolean }): App {
  const app = new Hono<AppEnv>()
  if (opts.log !== false) app.use('*', logger())
  app.use('*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })

  registerHealth(app)
  registerModels(app)
  registerSettings(app)
  registerChat(app)
  registerSessions(app)
  registerSpeech(app)
  registerStatic(app, opts.staticDir)

  app.onError((err, c) => {
    console.error('[error]', err)
    return c.json({ error: err.message }, 500)
  })

  return app
}
