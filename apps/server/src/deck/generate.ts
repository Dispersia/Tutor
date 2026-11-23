/**
 * Builds and grows decks from a user instruction (docs/DESIGN.md §13.7).
 *
 *   instruction → frequency list → planner → cards
 *
 * The pieces live in separate modules: `instruction` reads the prompt's language
 * rules, `context` holds the deck-wide context and the card-persisting helpers,
 * `build` creates and fills a deck, `growth` grows an existing one and `jobs`
 * runs a build in the background. Both the fetcher and the planner are injected,
 * so tests run offline.
 */

export * from './instruction'
export * from './context'
export * from './build'
export * from './growth'
export * from './jobs'
