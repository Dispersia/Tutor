import type { App } from '../../context'
import { registerDeckAudit } from './audit'
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
  registerDeckAudit(app)
}
