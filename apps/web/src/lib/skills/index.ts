/**
 * The skills/gear client surface (docs/ARCHITECTURE.md): wire
 * DTOs in `types.ts` and the `fetch` wrappers in `client.ts`. Call sites keep
 * importing `#lib/skills`, so this barrel is the entry point.
 */

export * from './types'
export * from './client'
