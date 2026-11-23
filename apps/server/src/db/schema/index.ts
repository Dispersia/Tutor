/**
 * The SQLite schema, split by domain (docs/ARCHITECTURE.md).
 *
 * This barrel is the entry point: `db/client.ts` reads it as a namespace and
 * every repo module imports the tables it needs. The tables themselves are pure
 * declarations, grouped so a data edit touches one file.
 */

export * from './users'
export * from './content'
export * from './history'
export * from './game'
export * from './gear'
export * from './srs'
export * from './push'
