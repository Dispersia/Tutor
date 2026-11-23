/**
 * The push routes (docs/REFACTOR_PLAN.md §8.2, Phase 14): the VAPID key and
 * per-device subscribe/unsubscribe in `subscribe.ts`, the test + rig clock in
 * `test.ts`.
 */

import type { App } from '../../context'
import { registerPushSubscribe } from './subscribe'
import { registerPushTest } from './test'

export function registerPush(app: App) {
  registerPushSubscribe(app)
  registerPushTest(app)
}
