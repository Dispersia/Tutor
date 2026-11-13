import { createApp } from './app'
import { buildDeps } from './bootstrap'
import { env } from './env'
import { readTls } from './static'

const { deps, close } = buildDeps(env)
const app = createApp(deps, { staticDir: env.staticDir })

deps.supervisor.startWatchdog()
if (env.speechAutostart) void deps.supervisor.ensure()

const tls = readTls(env.tlsCert, env.tlsKey)

const server = Bun.serve({
  hostname: env.host,
  port: env.port,
  fetch: app.fetch,
  ...(tls ? { tls } : {}),
})

const scheme = tls ? 'https' : 'http'
console.log(
  `[server] tutor api on ${scheme}://${env.host}:${env.port} (openrouter=${
    deps.or.configured ? 'key set' : 'NO KEY'
  })`,
)
if (env.host !== '127.0.0.1') {
  console.log(`[server] LAN: ${scheme}://<your-ip>:${env.port} (needed for the phone)`)
}

async function shutdown(): Promise<void> {
  console.log('\n[server] shutting down…')
  deps.supervisor.stopWatchdog()
  await deps.supervisor.stop()
  close()
  server.stop()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
