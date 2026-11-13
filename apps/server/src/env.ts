import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** repo root: apps/server/src -> repo */
export const repoRoot = resolve(import.meta.dir, '../../..')

/** Minimal KEY=VALUE loader (Bun loads .env already; we add ~/.config/tutor/env). */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    const key = m[1]!
    let val = m[2]!
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvFile(join(repoRoot, '.env'))
loadEnvFile(join(homedir(), '.config/tutor/env'))

export type Role = 'conversation' | 'judge' | 'generator' | 'translator'
export const ROLES: Role[] = ['conversation', 'judge', 'generator', 'translator']

const num = (v: string | undefined, fallback: number): number =>
  v === undefined || v === '' ? fallback : Number(v)

export const env = {
  host: process.env.TUTOR_HOST ?? '127.0.0.1',
  port: num(process.env.TUTOR_PORT, 4318),

  dataDir: process.env.TUTOR_DATA_DIR ?? join(repoRoot, 'data'),
  modelsDir: process.env.TUTOR_MODELS_DIR ?? join(repoRoot, 'models'),
  staticDir: process.env.TUTOR_STATIC_DIR ?? join(repoRoot, 'apps/web/build'),
  pythonDir: join(repoRoot, 'python'),

  openrouterKey: process.env.OPENROUTER_API_KEY ?? process.env.TUTOR_OPENROUTER_KEY,

  /** Optional server secret: encrypts per-user OpenRouter keys at rest. */
  secret: process.env.TUTOR_SECRET,
  /** Allow new accounts to be created (first account is always the admin). */
  allowRegistration: (process.env.TUTOR_ALLOW_REGISTRATION ?? 'true').toLowerCase() === 'true',
  sessionTtlDays: num(process.env.TUTOR_SESSION_TTL_DAYS, 30),

  speechPort: num(process.env.TUTOR_SPEECH_PORT, 4319),
  speechUrl:
    process.env.TUTOR_SPEECH_URL ?? `http://127.0.0.1:${num(process.env.TUTOR_SPEECH_PORT, 4319)}`,
  speechIdleTimeoutMs: num(process.env.TUTOR_SPEECH_IDLE_TIMEOUT, 600) * 1000,
  speechAutostart: (process.env.TUTOR_SPEECH_AUTOSTART ?? 'false').toLowerCase() === 'true',

  tlsCert: process.env.TUTOR_TLS_CERT,
  tlsKey: process.env.TUTOR_TLS_KEY,

  defaultRoles: {
    conversation: process.env.TUTOR_MODEL_CONVERSATION ?? 'qwen/qwen3.8-27b',
    judge: process.env.TUTOR_MODEL_JUDGE ?? 'qwen/qwen3.8-27b',
    generator: process.env.TUTOR_MODEL_GENERATOR ?? 'qwen/qwen3.8-flash',
    translator: process.env.TUTOR_MODEL_TRANSLATOR ?? 'qwen/qwen3.8-flash',
  } satisfies Record<Role, string>,
} as const
