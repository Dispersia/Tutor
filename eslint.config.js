import js from '@eslint/js'
import globals from 'globals'
import svelte from 'eslint-plugin-svelte'
import tseslint from 'typescript-eslint'

/**
 * Lint + size-budget guardrails (docs/REFACTOR_PLAN.md, Phase 0).
 *
 * The size budget is the mechanical half of the decomposition: no file over
 * `MAX_LINES`, **no function over `MAX_FN_LINES`** (small by default — if a
 * function needs more than twenty lines it is doing more than one thing), no
 * signature over `MAX_PARAMS`. Every file is now inside the budget with no
 * exemption list (docs/REFACTOR_PLAN.md, phases 0–15); the only relaxations left
 * are `legacyBig` (the web route shells) and the data-table / test ceilings.
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

/**
 * The web pages still awaiting their Phase-15 split (and one script): the size
 * ceiling is off here, nothing else. **Remove a page as it comes under budget**,
 * so the exemption only shrinks. `home` is already off the list.
 */
const legacyBig = [
  'apps/web/src/routes/(app)/chat/+page.svelte',
  'apps/web/src/routes/(app)/combat/+page.svelte',
  'apps/web/src/routes/(app)/practice/+page.svelte',
  'apps/web/src/routes/(app)/settings/+page.svelte',
  'apps/web/src/routes/(app)/skills/+page.svelte',
  'apps/web/src/routes/(app)/skills/\\[id\\]/+page.svelte',
  'scripts/sweep-cards.ts',
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

  // Content tables (`*.data.ts`) are data, not logic: the budget is for code.
  {
    files: ['**/*.data.ts'],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off', 'max-params': 'off' },
  },

  // Tests are arrange/act/assert: long, but their bodies still obey a ceiling
  // (a larger one than production code — a case reads as one unit).
  {
    files: ['**/*.test.ts', '**/*.test.js'],
    languageOptions: { globals: bunTest },
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    },
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
