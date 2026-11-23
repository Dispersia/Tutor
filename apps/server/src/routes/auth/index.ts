/**
 * The auth routes (docs/REFACTOR_PLAN.md §8.2, Phase 14). `session.ts` holds the
 * cookie/session helpers (re-used by the app's auth gate and `/api/models`);
 * `account.ts` the register/login/profile endpoints; `admin.ts` the user list.
 */

import type { App } from '../../context'
import { registerAccounts } from './account'
import { registerAuthAdmin } from './admin'

export function registerAuth(app: App) {
  registerAccounts(app)
  registerAuthAdmin(app)
}

// The app gate and `/api/models` read the signed-in user from here.
export { currentUser } from './session'
