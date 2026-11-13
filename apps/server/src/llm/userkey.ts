import { decryptSecret, encryptSecret } from '../auth'
import type { Deps } from '../context'
import { getUserSetting, setUserSetting } from '../db/repo'

/** A user's own OpenRouter key, falling back to the server key if unset. */
export async function resolveUserKey(deps: Deps, userId: string): Promise<string | undefined> {
  const stored = getUserSetting(deps.db, userId, 'openrouter_key')
  const userKey = await decryptSecret(stored || undefined, deps.secret)
  return userKey || deps.serverKey
}

export function hasUserKey(deps: Deps, userId: string): 'user' | 'server' | false {
  if (getUserSetting(deps.db, userId, 'openrouter_key')) return 'user'
  return deps.serverKey ? 'server' : false
}

export async function saveUserKey(deps: Deps, userId: string, key: string): Promise<void> {
  if (!key.trim()) {
    setUserSetting(deps.db, userId, 'openrouter_key', '')
    return
  }
  setUserSetting(deps.db, userId, 'openrouter_key', await encryptSecret(key.trim(), deps.secret))
}
