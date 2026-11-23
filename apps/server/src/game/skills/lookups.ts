/**
 * Id → definition maps, built once at load (docs/DESIGN.md §13.5).
 */

import { ACTIONS } from './actions.data'
import { ITEMS } from './items.data'
import { SKILLS } from './skills.data'

// --- lookups -----------------------------------------------------------------

export const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]))
export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]))
export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]))
