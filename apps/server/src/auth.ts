import { createHash, randomBytes } from 'node:crypto'

export const SESSION_COOKIE = 'tutor_session'

/** Passwords are hashed with argon2id via Bun's built-in implementation. */
export function hashPassword(pw: string): Promise<string> {
  return Bun.password.hash(pw, { algorithm: 'argon2id' })
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return Bun.password.verify(pw, hash)
}

/** Opaque session token (goes in the cookie). */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** We only store a hash of the token, so a DB leak can't be replayed. */
export function tokenId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// --- optional symmetric encryption for per-user OpenRouter keys --------------

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = createHash('sha256').update(secret).digest()
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/**
 * Encrypts a secret at rest. Without a server secret we fall back to plaintext
 * marked `plain:` (the DB is local-only; set TUTOR_SECRET to encrypt).
 */
export async function encryptSecret(plain: string, secret?: string): Promise<string> {
  if (!secret) return `plain:${plain}`
  const key = await aesKey(secret)
  const iv = randomBytes(12)
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)),
  )
  return `enc:v1:${iv.toString('base64url')}:${Buffer.from(data).toString('base64url')}`
}

export async function decryptSecret(
  stored: string | undefined,
  secret?: string,
): Promise<string | undefined> {
  if (!stored) return undefined
  if (stored.startsWith('plain:')) return stored.slice('plain:'.length)
  if (!stored.startsWith('enc:v1:')) return stored
  if (!secret) return undefined
  const [, , ivPart, dataPart] = stored.split(':')
  if (!ivPart || !dataPart) return undefined
  try {
    const key = await aesKey(secret)
    const iv = Buffer.from(ivPart, 'base64url')
    const data = Buffer.from(dataPart, 'base64url')
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(dec)
  } catch {
    return undefined
  }
}
