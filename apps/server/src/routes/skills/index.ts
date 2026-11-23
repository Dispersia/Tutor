/**
 * The profession routes (docs/ARCHITECTURE.md).
 *
 * One concern per file: `board` (the view builders), `catalog` (the board and a
 * single profession), `talents`, `rigs` (reciped choice + stopping a run), `gear`
 * and `sets`.
 */

import type { App } from '../../context'
import { registerSkillCatalog } from './catalog'
import { registerSkillGear } from './gear'
import { registerSkillRigs } from './rigs'
import { registerSkillSets } from './sets'
import { registerSkillTalents } from './talents'

export function registerSkills(app: App) {
  // Hono matches in registration order, so every literal `/api/skills/<word>`
  // route must be registered before the catalog's `/api/skills/:id`.
  registerSkillTalents(app)
  registerSkillRigs(app)
  registerSkillGear(app)
  registerSkillSets(app)
  registerSkillCatalog(app)
}
