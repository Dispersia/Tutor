import type { App } from '../../context'
import { registerAccounts } from './account'
import { registerAuthAdmin } from './admin'

export function registerAuth(app: App) {
  registerAccounts(app)
  registerAuthAdmin(app)
}

export { currentUser } from './session'
