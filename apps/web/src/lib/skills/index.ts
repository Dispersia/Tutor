/**
 * The skills/gear client surface (docs/REFACTOR_PLAN.md §8.2, Phase 12): wire
 * DTOs in `types.ts` and the `fetch` wrappers in `client.ts`. Call sites keep
 * importing `#lib/skills`, so this barrel is the entry point.
 */

export * from './types'
export * from './client'
