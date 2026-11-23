import type { Context } from 'hono'
import type { AppEnv } from '../context'

export function adminOnly(c: Context<AppEnv>): Response | undefined {
  return c.get('user')?.role === 'admin' ? undefined : c.json({ error: 'forbidden' }, 403)
}
