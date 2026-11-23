import { withGateway } from './gateway'

export interface SpeechStatus {
  running: boolean
  ready: boolean
  models: string[]
  pid?: number
  url: string
  idleForMs: number
  idleTimeoutMs: number
}

export interface SupervisorConfig {
  url: string
  port: number
  pythonDir: string
  modelsDir: string
  idleTimeoutMs: number
  autostart: boolean
  spawn?: (cmd: string[], opts: Record<string, unknown>) => SubprocessLike
}

function gatewayEnv(
  cfg: { port: number; idleTimeoutMs: number; modelsDir: string },
  base: NodeJS.ProcessEnv,
): Record<string, string> {
  return {
    ...base,
    TUTOR_SPEECH_PORT: String(cfg.port),
    TUTOR_SPEECH_IDLE_TIMEOUT: String(Math.round(cfg.idleTimeoutMs / 1000)),
    TUTOR_SPEECH_EXIT_ON_IDLE: 'false',
    TUTOR_MODELS_DIR: cfg.modelsDir,
    HF_HOME: cfg.modelsDir,
  }
}

interface SubprocessLike {
  pid: number
  exitCode: number | null
  exited?: Promise<unknown>
  kill(signal?: number | string): void
}

const EXIT_GRACE_MS = 5000

async function settledWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  const done = p.then(
    () => true,
    () => true,
  )
  const settled = await Promise.race([done, timeout])
  clearTimeout(timer)
  return settled
}

async function killAndWait(proc: SubprocessLike, graceMs = EXIT_GRACE_MS): Promise<void> {
  try {
    proc.kill()
  } catch {
    return
  }
  if (!proc.exited || proc.exitCode !== null) return
  if (await settledWithin(proc.exited, graceMs)) return
  try {
    proc.kill('SIGKILL')
  } catch {
    return
  }
  await settledWithin(proc.exited, graceMs)
}

function isGatewayHealth(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const h = body as Record<string, unknown>
  return typeof h.idleTimeoutMs === 'number' && Array.isArray(h.models)
}

export function shouldStopSpeech(o: {
  running: boolean
  idleMs: number
  active: number
  timeoutMs: number
}): boolean {
  return o.running && o.active === 0 && o.idleMs >= o.timeoutMs
}

export class SpeechSupervisor {
  #proc?: SubprocessLike
  #lastActivity = Date.now()
  #active = 0
  #starting?: Promise<void>
  #stopping?: Promise<void>
  #adopted = false
  #watchdog?: ReturnType<typeof setInterval>

  constructor(readonly cfg: SupervisorConfig) {}

  get url(): string {
    return this.cfg.url
  }

  get running(): boolean {
    return this.#spawned() || this.#adopted
  }

  #spawned(): boolean {
    return Boolean(this.#proc) && this.#proc!.exitCode === null
  }

  touch(): void {
    this.#lastActivity = Date.now()
  }

  begin(): void {
    this.#active++
    this.touch()
  }

  end(): void {
    this.#active = Math.max(0, this.#active - 1)
    this.touch()
  }

  idleMs(): number {
    return Date.now() - this.#lastActivity
  }

  activity(): { idleForMs: number; activeStreams: number } {
    return { idleForMs: this.idleMs(), activeStreams: this.#active }
  }

  async ensure(): Promise<void> {
    if (this.#stopping) await this.#stopping
    if (this.#starting) return this.#starting
    if (this.#spawned()) return
    this.#starting = this.#adoptOrSpawn()
    try {
      await this.#starting
    } finally {
      this.#starting = undefined
    }
  }

  async #adoptOrSpawn(): Promise<void> {
    this.#adopted = await this.#gatewayAnswers()
    if (this.#adopted) return this.touch()
    await this.#spawnAndWait()
  }

  async #gatewayAnswers(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.url}/health`, { signal: AbortSignal.timeout(2000) })
      return res.ok && isGatewayHealth(await res.json())
    } catch {
      return false
    }
  }

  async #spawnAndWait(): Promise<void> {
    const cmd = ['uv', 'run', 'python', '-m', 'speech.server']
    const spawn =
      this.cfg.spawn ??
      ((c, o) =>
        (Bun as unknown as { spawn: (c: string[], o: unknown) => SubprocessLike }).spawn(c, o))
    console.log(`[speech] starting gateway: ${cmd.join(' ')} (cwd=${this.cfg.pythonDir})`)
    this.#proc = spawn(cmd, {
      cwd: this.cfg.pythonDir,
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      env: gatewayEnv(this.cfg, process.env),
    })
    this.touch()
    await this.#waitHealthy()
  }

  async #waitHealthy(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.#proc && this.#proc.exitCode !== null) {
        throw new Error(
          'speech gateway exited during startup — run `just setup` (uv sync) and check the log',
        )
      }
      try {
        const res = await fetch(`${this.cfg.url}/health`, { signal: AbortSignal.timeout(2000) })
        if (res.ok) return
      } catch {}
      await Bun.sleep(500)
    }
    throw new Error('speech gateway did not become healthy in time')
  }

  async warm(): Promise<void> {
    await withGateway(this, async (url) => {
      const res = await fetch(`${url}/v1/warm`, {
        method: 'POST',
        signal: AbortSignal.timeout(180_000),
      })
      if (!res.ok) throw new Error(`speech gateway warm -> ${res.status}`)
    })
  }

  async health(): Promise<Record<string, unknown>> {
    try {
      const res = await fetch(`${this.cfg.url}/health`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) throw new Error(String(res.status))
      return (await res.json()) as Record<string, unknown>
    } catch {
      return { ready: false, models: [], asleep: true }
    }
  }

  async status(): Promise<SpeechStatus> {
    const h = await this.health()
    return {
      running: this.running,
      ready: Boolean(h.ready),
      models: (h.models as string[]) ?? [],
      pid: this.#proc?.pid,
      url: this.cfg.url,
      idleForMs: this.idleMs(),
      idleTimeoutMs: this.cfg.idleTimeoutMs,
    }
  }

  async stop(): Promise<void> {
    if (this.#stopping) return this.#stopping
    if (this.#adopted) await this.#releaseAdopted()
    const proc = this.#proc
    if (!proc) return
    console.log('[speech] stopping gateway (freeing RAM)')
    this.#proc = undefined
    this.#stopping = killAndWait(proc).finally(() => {
      this.#stopping = undefined
    })
    return this.#stopping
  }

  async #releaseAdopted(): Promise<void> {
    this.#adopted = false
    console.log('[speech] stopping the adopted gateway')
    const post = (path: string) =>
      fetch(`${this.cfg.url}${path}`, { method: 'POST', signal: AbortSignal.timeout(5000) })
    try {
      const res = await post('/admin/shutdown')
      if (res.status === 404) await post('/admin/unload')
    } catch {}
  }

  startWatchdog(intervalMs = 15_000): void {
    if (this.#watchdog) return
    this.#watchdog = setInterval(() => {
      const stop = shouldStopSpeech({
        running: this.running,
        idleMs: this.idleMs(),
        active: this.#active,
        timeoutMs: this.cfg.idleTimeoutMs,
      })
      if (stop) void this.stop()
    }, intervalMs)
    this.#watchdog.unref?.()
  }

  stopWatchdog(): void {
    if (this.#watchdog) clearInterval(this.#watchdog)
    this.#watchdog = undefined
  }
}
