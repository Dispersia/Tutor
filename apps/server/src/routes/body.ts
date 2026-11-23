/**
 * Request bodies (docs/ARCHITECTURE.md).
 *
 * Every JSON handler reads its body through here instead of casting
 * `await c.req.json()`: the parse never throws (a missing or malformed body is an
 * empty object), and each reader checks the runtime type, so a wrong-typed field
 * reads as absent rather than being trusted.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../context'

/** The parsed JSON object body, or `{}` when it is missing or not an object. */
export async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const raw = await c.req.json().catch(() => undefined)
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

/** A string field, or undefined. */
export function str(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key]
  return typeof v === 'string' ? v : undefined
}

/** A finite-number field, or undefined. */
export function num(body: Record<string, unknown>, key: string): number | undefined {
  const v = body[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** A boolean field, or undefined. */
export function bool(body: Record<string, unknown>, key: string): boolean | undefined {
  const v = body[key]
  return typeof v === 'boolean' ? v : undefined
}

/** A nested object field, or undefined. */
export function obj(
  body: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = body[key]
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined
}

/** An array field narrowed to its string entries, or undefined when not an array. */
export function strArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const v = body[key]
  if (!Array.isArray(v)) return undefined
  return v.filter((x): x is string => typeof x === 'string')
}

/** An object field narrowed to string values, or undefined. */
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

/** A field restricted to one of `allowed`, or undefined. */
export function oneOf<T extends string>(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const v = body[key]
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

/**
 * A string field branded as an id, or undefined: `idField(body, 'cardId', toCardId)`.
 * Ids arriving over HTTP are tagged here, at the point they are read (`ids.ts`).
 */
export function idField<T>(
  body: Record<string, unknown>,
  key: string,
  brand: (s: string) => T,
): T | undefined {
  const v = str(body, key)
  return v === undefined ? undefined : brand(v)
}
