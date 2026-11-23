import type { UserId } from '../ids'
import { decryptSecret, encryptSecret } from '../auth'
import type { Deps } from '../context'
import { getUserSetting, setUserSetting } from '../db/repo'

/** The key a request runs on, and whose it is. */
export interface ResolvedKey {
  key: string
  /** `user`: the member's own key. `server`: the shared key the server pays for. */
  source: 'user' | 'server'
}

/**
 * The key for a user's request and whose it is — the caller needs to know,
 * because a request billed to the server's key gets less freedom (the chat
 * route will not let it pick a model or supply its own prompt).
 */
export async function resolveKey(deps: Deps, userId: UserId): Promise<ResolvedKey | undefined> {
  const stored = getUserSetting(deps.db, userId, 'openrouter_key')
  const userKey = await decryptSecret(stored || undefined, deps.secret)
  if (userKey) return { key: userKey, source: 'user' }
  return deps.serverKey ? { key: deps.serverKey, source: 'server' } : undefined
}

/** A user's own OpenRouter key, falling back to the server key if unset. */
export async function resolveUserKey(deps: Deps, userId: UserId): Promise<string | undefined> {
  return (await resolveKey(deps, userId))?.key
}

export function hasUserKey(deps: Deps, userId: UserId): 'user' | 'server' | false {
  if (getUserSetting(deps.db, userId, 'openrouter_key')) return 'user'
  return deps.serverKey ? 'server' : false
}

export async function saveUserKey(deps: Deps, userId: UserId, key: string): Promise<void> {
  if (!key.trim()) {
    setUserSetting(deps.db, userId, 'openrouter_key', '')
    return
  }
  setUserSetting(deps.db, userId, 'openrouter_key', await encryptSecret(key.trim(), deps.secret))
}
