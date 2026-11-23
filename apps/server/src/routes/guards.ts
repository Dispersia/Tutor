/** Route guards shared across resources. */

import type { Context } from 'hono'
import type { AppEnv } from '../context'

/**
 * A 403 for anyone but the admin, else undefined. For the controls that act on
 * the whole server rather than the caller's own data (the shared recording
 * queue, the speech gateway, the member list).
 */
export function adminOnly(c: Context<AppEnv>): Response | undefined {
  return c.get('user')?.role === 'admin' ? undefined : c.json({ error: 'forbidden' }, 403)
}
