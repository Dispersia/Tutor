import type { App } from '../../context'
import { registerSkillCatalog } from './catalog'
import { registerSkillGear } from './gear'
import { registerSkillRigs } from './rigs'
import { registerSkillSets } from './sets'
import { registerSkillTalents } from './talents'

export function registerSkills(app: App) {
  registerSkillTalents(app)
  registerSkillRigs(app)
  registerSkillGear(app)
  registerSkillSets(app)
  registerSkillCatalog(app)
}
