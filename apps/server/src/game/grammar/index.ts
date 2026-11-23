/**
 * The n+1 sentence builder, split from the pattern tables it reads
 * (docs/ARCHITECTURE.md):
 *
 * - `patterns.data.ts` — `PATTERNS` and the semantic/gloss tables (content).
 * - `build.ts` — `buildSentence` and `canBuildSentence` (the engine).
 *
 * Call sites kept importing `game/grammar`, so this barrel preserves the path.
 */

export * from './build'
export { PATTERNS, nounClass, type NounClass, type Pattern, type Slot } from './patterns.data'
