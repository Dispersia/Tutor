/**
 * The profession routes (docs/REFACTOR_PLAN.md §8.2, Phase 14).
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
  registerSkillCatalog(app)
  registerSkillTalents(app)
  registerSkillRigs(app)
  registerSkillGear(app)
  registerSkillSets(app)
}
