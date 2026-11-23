import js from '@eslint/js'
import globals from 'globals'
import svelte from 'eslint-plugin-svelte'
import tseslint from 'typescript-eslint'
import { longFunctions } from './eslint.function-baseline.js'

/**
 * Lint + size-budget guardrails (docs/REFACTOR_PLAN.md, Phase 0).
 *
 * The size budget is the mechanical half of the decomposition: no file over
 * `MAX_LINES`, **no function over `MAX_FN_LINES`** (small by default — if a
 * function needs more than twenty lines it is doing more than one thing), no
 * signature over `MAX_PARAMS`. New code is held to the budget from day one. The
 * functions still being split are listed in `eslint.function-baseline.js` with
 * the function ceiling off — **that list only ever shrinks**.
 *
 * Errors fail `bun run lint`; warnings are advisory (they name existing rough
 * edges that the phase plan works through).
 */
const MAX_LINES = 400
const MAX_FN_LINES = 20
const MAX_PARAMS = 5

const sizeRules = {
  'max-lines': ['error', { max: MAX_LINES, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': [
    'error',
    { max: MAX_FN_LINES, skipBlankLines: true, skipComments: true },
  ],
  'max-params': ['error', MAX_PARAMS],
}

/** Mega files awaiting decomposition: the size ceiling is off here, nothing else. */
const legacyBig = ['apps/web/src/routes/**/*.svelte', 'scripts/sweep-cards.ts']

/**
 * Files whose own length is fine but which still hold one oversized function or
 * signature. Only the function ceiling is off here, so the file budget still
 * applies. Remove each entry once its function is split.
 */
const legacyFunctions = longFunctions

/** Wide signatures that predate the budget; fold these into options objects as
 * they are touched. Only `max-params` is relaxed for these files. */
const wideSignatures = [
  'apps/server/src/audio/service.ts',
  'apps/server/src/game/bands.ts',
  'apps/server/src/game/srs.ts',
  'apps/server/src/routes/auth.ts',
  'apps/server/src/routes/chat.ts',
  'apps/server/src/routes/combat.ts',
  'apps/server/src/routes/settings.ts',
  'apps/server/src/routes/skills.ts',
  'apps/server/src/services/gear.ts',
  'apps/server/src/services/items.ts',
  'apps/server/src/services/idle.ts',
  'apps/server/src/services/overview.ts',
  'apps/server/src/services/srs.ts',
]

/** `bun test` globals (the `globals` package has no bun preset). */
const bunTest = {
  test: 'readonly',
  it: 'readonly',
  describe: 'readonly',
  expect: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  mock: 'readonly',
  spyOn: 'readonly',
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.svelte-kit/**',
      '**/static/**',
      '**/*.gen.ts',
      'data/**',
      'models/**',
      'python/**',
      'result/**',
      'tmp/**',
      'design/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, Bun: 'readonly' },
    },
    rules: {
      ...sizeRules,
      // Soft ceilings on the other dimensions of "too big".
      complexity: ['warn', 20],
      'max-depth': ['warn', 4],
      'max-statements': ['warn', 40],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Legacy mega files: hold correctness, drop only the size ceiling.
  {
    files: legacyBig,
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off', 'max-params': 'off' },
  },

  // Files with one oversized function left: keep the file ceiling, drop the rest.
  {
    files: legacyFunctions,
    rules: { 'max-lines-per-function': 'off' },
  },

  // Files whose wide signatures predate the budget; fold these into options
  // objects as they are touched. Only `max-params` is relaxed here.
  {
    files: wideSignatures,
    rules: { 'max-params': 'off' },
  },

  // Content tables (`*.data.ts`) are data, not logic: the budget is for code.
  {
    files: ['**/*.data.ts'],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off', 'max-params': 'off' },
  },

  // Tests may be long, but their functions still obey the ceiling.
  {
    files: ['**/*.test.ts', '**/*.test.js'],
    languageOptions: { globals: bunTest },
    rules: { 'max-lines': 'off' },
  },

  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] },
    },
    rules: {
      // SvelteKit 3 wants `resolve()` navigation everywhere, and Svelte 5 wants
      // SvelteMap/SvelteSet: both are Phase 6 work, not Phase 0.
      'svelte/no-navigation-without-resolve': 'warn',
      'svelte/prefer-svelte-reactivity': 'warn',
    },
  },

  { files: ['**/*.mjs', '**/*.js'], languageOptions: { globals: { ...globals.node } } },
)
