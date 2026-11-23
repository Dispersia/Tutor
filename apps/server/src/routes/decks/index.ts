/**
 * The deck routes (docs/ARCHITECTURE.md).
 *
 * One concern per file: `list`, `create`, `import` (inspect + import), `cards`,
 * `grow`, `settings` and `pitch`. The wire view lives in `view.ts`.
 */

import type { App } from '../../context'
import { registerDeckCards } from './cards'
import { registerDeckCreate } from './create'
import { registerDeckGrow } from './grow'
import { registerDeckImport } from './import'
import { registerDeckList } from './list'
import { registerDeckPitch } from './pitch'
import { registerDeckSettings } from './settings'

export function registerDecks(app: App) {
  registerDeckList(app)
  registerDeckCreate(app)
  registerDeckImport(app)
  registerDeckCards(app)
  registerDeckGrow(app)
  registerDeckSettings(app)
  registerDeckPitch(app)
}
