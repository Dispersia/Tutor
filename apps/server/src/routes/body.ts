import type { Context } from 'hono'
import type { AppEnv } from '../context'

export async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const raw = await c.req.json().catch(() => undefined)
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

export function str(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key]
  return typeof v === 'string' ? v : undefined
}

export function num(body: Record<string, unknown>, key: string): number | undefined {
  const v = body[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function bool(body: Record<string, unknown>, key: string): boolean | undefined {
  const v = body[key]
  return typeof v === 'boolean' ? v : undefined
}

export function obj(
  body: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = body[key]
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined
}

export function strArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const v = body[key]
  if (!Array.isArray(v)) return undefined
  return v.filter((x): x is string => typeof x === 'string')
}

export function strRecord(
  body: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const v = body[key]
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val
  return out
}

export function oneOf<T extends string>(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const v = body[key]
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

export function idField<T>(
  body: Record<string, unknown>,
  key: string,
  brand: (s: string) => T,
): T | undefined {
  const v = str(body, key)
  return v === undefined ? undefined : brand(v)
}
