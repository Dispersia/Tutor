import type { App } from '../../context'
import { registerPushSubscribe } from './subscribe'
import { registerPushTest } from './test'

export function registerPush(app: App) {
  registerPushSubscribe(app)
  registerPushTest(app)
}
