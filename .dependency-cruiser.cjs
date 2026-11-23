/**
 * Architecture guardrails (docs/ARCHITECTURE.md).
 *
 * Two jobs: catch import cycles (valuable today) and hold the layer direction
 * the decomposition introduced: routes → services → db → game, never backwards.
 * The rules name the folders that exist (`game/` is the domain, `db/` the data
 * layer). Run with `bun run arch`.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle makes two modules one, so neither can be read, tested or split alone.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment: 'game/ is the rules of the world: no database, services, routes or HTTP.',
      from: { path: '^apps/server/src/game', pathNot: '\\.test\\.ts$' },
      to: { path: '^apps/server/src/(db|services|routes|context|app)' },
    },
    {
      name: 'data-has-no-upward-deps',
      severity: 'error',
      comment: 'db/ reads the database and the domain only — never services or routes.',
      from: { path: '^apps/server/src/db', pathNot: '\\.test\\.ts$' },
      to: { path: '^apps/server/src/(services|routes)' },
    },
    {
      name: 'services-skip-routes',
      severity: 'error',
      comment: 'services/ orchestrate domain + data; only routes/ touch HTTP.',
      from: { path: '^apps/server/src/services' },
      to: { path: '^apps/server/src/routes' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'A module nothing imports is either dead or a missing wiring step.',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)index\\.ts$', '\\.test\\.ts$'] },
      to: {},
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
    },
    moduleSystems: ['es6', 'cjs', 'tsd'],
    // Count `import type` edges too: layering must hold for types as well.
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(build|dist|\\.svelte-kit|migrations\\.gen\\.ts)' },
  },
}
