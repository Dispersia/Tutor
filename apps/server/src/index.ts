import { createApp } from './app'
import { buildDeps } from './bootstrap'
import { env } from './env'
import { startRigNotifier } from './push/notify'
import { readTls } from './static'

const { deps, close } = buildDeps(env)
const app = createApp(deps, { staticDir: env.staticDir })

/**
 * Serves the app at the root and under `base`: requests to `<base>/…` have the
 * prefix stripped before dispatch, so the app's own routes stay root-relative.
 */
function makeFetch(base: string): (req: Request) => Response | Promise<Response> {
  return (req) => {
    const url = new URL(req.url)
    if (url.pathname === base || url.pathname.startsWith(`${base}/`)) {
      url.pathname = url.pathname.slice(base.length) || '/'
      return app.fetch(new Request(url, req))
    }
    return app.fetch(req)
  }
}

const fetchHandler = env.basePath ? makeFetch(env.basePath) : app.fetch

deps.supervisor.startWatchdog()
if (env.speechAutostart) void deps.supervisor.ensure()
const stopRigNotifier = startRigNotifier({ db: deps.db })

const tls = readTls(env.tlsCert, env.tlsKey)

const server = Bun.serve({
  hostname: env.host,
  port: env.port,
  fetch: fetchHandler,
  // A cold speech warm loads three MLX checkpoints (can take >10s, Bun's default
  // request timeout), which would otherwise fail the request and show as
  // "audio unavailable". Allow the whole warm window.
  idleTimeout: 200,
  ...(tls ? { tls } : {}),
})

const scheme = tls ? 'https' : 'http'
console.log(
  `[server] tutor api on ${scheme}://${env.host}:${env.port}${env.basePath}/ (openrouter=${
    deps.or.configured ? 'key set' : 'NO KEY'
  })`,
)
if (env.host !== '127.0.0.1') {
  console.log(`[server] LAN: ${scheme}://<your-ip>:${env.port} (needed for the phone)`)
}

async function shutdown(): Promise<void> {
  console.log('\n[server] shutting down…')
  stopRigNotifier()
  deps.supervisor.stopWatchdog()
  await deps.supervisor.stop()
  close()
  server.stop()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
