import { ACTIONS } from './actions.data'
import { ITEMS } from './items.data'
import { SKILLS } from './skills.data'

export const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]))
export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]))
export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]))
