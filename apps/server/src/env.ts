import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../../..')

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

export const roleReasoning: Record<Role, 'none' | 'low' | 'medium' | 'high' | 'xhigh'> = {
  conversation: 'none',
  judge: 'low',
  generator: 'none',
  translator: 'none',
}

const num = (v: string | undefined, fallback: number): number =>
  v === undefined || v === '' ? fallback : Number(v)

const dir = (value: string | undefined, fallback: string): string =>
  resolve(repoRoot, value?.trim() || fallback)

function normalizeBase(v: string | undefined): string {
  if (!v) return ''
  const trimmed = v.trim().replace(/\/+$/, '')
  if (trimmed === '' || trimmed === '/') return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

export const env = {
  host: process.env.TUTOR_HOST ?? '127.0.0.1',
  port: num(process.env.TUTOR_PORT, 4318),

  dataDir: dir(process.env.TUTOR_DATA_DIR, 'data'),
  modelsDir: dir(process.env.TUTOR_MODELS_DIR, 'models'),
  staticDir: dir(process.env.TUTOR_STATIC_DIR, 'apps/web/build'),
  basePath: normalizeBase(process.env.TUTOR_BASE_PATH),
  pythonDir: dir(process.env.TUTOR_PYTHON_DIR, 'python'),

  openrouterKey: process.env.OPENROUTER_API_KEY ?? process.env.TUTOR_OPENROUTER_KEY,

  secret: process.env.TUTOR_SECRET,
  allowRegistration: (process.env.TUTOR_ALLOW_REGISTRATION ?? 'true').toLowerCase() === 'true',
  sessionTtlDays: num(process.env.TUTOR_SESSION_TTL_DAYS, 30),

  speechPort: num(process.env.TUTOR_SPEECH_PORT, 4319),
  speechUrl:
    process.env.TUTOR_SPEECH_URL ?? `http://127.0.0.1:${num(process.env.TUTOR_SPEECH_PORT, 4319)}`,
  speechIdleTimeoutMs: num(process.env.TUTOR_SPEECH_IDLE_TIMEOUT, 3600) * 1000,
  speechAutostart: (process.env.TUTOR_SPEECH_AUTOSTART ?? 'false').toLowerCase() === 'true',

  tlsCert: process.env.TUTOR_TLS_CERT,
  tlsKey: process.env.TUTOR_TLS_KEY,

  pushSubject: process.env.TUTOR_PUSH_SUBJECT ?? 'mailto:push@localhost',

  defaultRoles: {
    conversation: process.env.TUTOR_MODEL_CONVERSATION ?? 'qwen/qwen3.8-27b',
    judge: process.env.TUTOR_MODEL_JUDGE ?? 'qwen/qwen3.8-27b',
    generator: process.env.TUTOR_MODEL_GENERATOR ?? 'qwen/qwen3.8-flash',
    translator: process.env.TUTOR_MODEL_TRANSLATOR ?? 'qwen/qwen3.8-flash',
  } satisfies Record<Role, string>,
} as const
