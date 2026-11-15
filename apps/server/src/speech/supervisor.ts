/**
 * Speech supervisor (docs/DESIGN.md §8): owns the Python/MLX gateway's lifetime —
 * lazy start on first use, idle stop to give RAM back to the Mac, health polling.
 */

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
  /** injectable for tests */
  spawn?: (cmd: string[], opts: Record<string, unknown>) => SubprocessLike
}

interface SubprocessLike {
  pid: number
  exitCode: number | null
  kill(signal?: number | string): void
}

/** Pure decision function — unit-tested. */
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
  #watchdog?: ReturnType<typeof setInterval>

  constructor(readonly cfg: SupervisorConfig) {}

  get url(): string {
    return this.cfg.url
  }

  get running(): boolean {
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

  /** Starts the gateway if it isn't running. Safe to call concurrently. */
  async ensure(): Promise<void> {
    if (this.running) return
    if (this.#starting) return this.#starting
    this.#starting = this.#spawnAndWait()
    try {
      await this.#starting
    } finally {
      this.#starting = undefined
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
      env: {
        ...process.env,
        TUTOR_SPEECH_PORT: String(this.cfg.port),
        TUTOR_SPEECH_IDLE_TIMEOUT: String(Math.round(this.cfg.idleTimeoutMs / 1000)),
        // the supervisor owns the process lifetime; child only unloads models
        TUTOR_SPEECH_EXIT_ON_IDLE: 'false',
        TUTOR_MODELS_DIR: this.cfg.modelsDir,
        HF_HOME: this.cfg.modelsDir,
      },
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
      } catch {
        // not up yet
      }
      await Bun.sleep(500)
    }
    throw new Error('speech gateway did not become healthy in time')
  }

  /**
   * Starts the gateway if needed, then loads the models a voice card needs
   * (ASR + aligner + preset TTS) so the first "Hear it" / "Say it" tap skips the
   * model-load latency (DESIGN §8.1). Idempotent: warm models load instantly.
   */
  async warm(): Promise<void> {
    await this.ensure()
    this.begin()
    try {
      const res = await fetch(`${this.cfg.url}/v1/warm`, {
        method: 'POST',
        signal: AbortSignal.timeout(180_000),
      })
      if (!res.ok) throw new Error(`speech gateway warm -> ${res.status}`)
    } finally {
      this.end()
    }
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
    if (!this.#proc) return
    console.log('[speech] stopping gateway (freeing RAM)')
    try {
      this.#proc.kill()
    } catch {
      // already gone
    }
    this.#proc = undefined
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
