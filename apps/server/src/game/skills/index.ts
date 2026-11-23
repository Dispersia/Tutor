/**
 * Professions (docs/DESIGN.md §13.5).
 *
 * Normal RuneScape/WoW-style skills. Actions are *not* tied to an exercise type:
 * training an action gives you "the next drill", and a correct answer awards that
 * profession's XP + materials. Gathering skills produce raw materials, artisan
 * skills consume them, and combat skills require equipment forged by the artisans.
 * A completed drill also powers the action's **idle rig** (docs §13.5.1), which goes
 * on earning XP and materials by the clock until its run drains out.
 *
 * Split by concern: `types` (contracts), `slots` / `xp` (rules), the `*.data`
 * content tables, and `actions` (queries + rolls). Import from `game/skills`.
 */

export * from './types'
export * from './slots'
export * from './xp'
export * from './skills.data'
export * from './gems'
export * from './essences'
export * from './value'
export * from './enchants'
export * from './items.data'
export * from './actions.data'
export * from './lookups'
export * from './actions'
