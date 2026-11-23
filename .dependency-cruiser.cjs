/**
 * Architecture guardrails (docs/REFACTOR_PLAN.md, Phase 0).
 *
 * Two jobs: catch import cycles (valuable today) and hold the layer direction
 * the decomposition introduces: routes → services → data → domain, never
 * backwards. The layer rules name folders that the phases will create; until
 * then they simply match nothing. Run with `bun run arch`.
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
      comment: 'domain/ is the rules of the world: no data, services, routes or HTTP.',
      from: { path: '^apps/server/src/domain' },
      to: { path: '^apps/server/src/(data|services|routes|context|app)' },
    },
    {
      name: 'data-has-no-upward-deps',
      severity: 'error',
      comment: 'data/ reads the database and the domain only — never services or routes.',
      from: { path: '^apps/server/src/data' },
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
