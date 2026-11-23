import type { UserId } from '../ids'
import { decryptSecret, encryptSecret } from '../auth'
import type { Deps } from '../context'
import { getUserSetting, setUserSetting } from '../db/repo'

export interface ResolvedKey {
  key: string
  source: 'user' | 'server'
}

export async function resolveKey(deps: Deps, userId: UserId): Promise<ResolvedKey | undefined> {
  const stored = getUserSetting(deps.db, userId, 'openrouter_key')
  const userKey = await decryptSecret(stored || undefined, deps.secret)
  if (userKey) return { key: userKey, source: 'user' }
  return deps.serverKey ? { key: deps.serverKey, source: 'server' } : undefined
}

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
