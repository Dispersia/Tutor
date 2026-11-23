import js from '@eslint/js'
import globals from 'globals'
import svelte from 'eslint-plugin-svelte'
import tseslint from 'typescript-eslint'

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
      'no-empty': ['error', { allowEmptyCatch: true }],
      ...sizeRules,
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

  {
    files: ['**/*.data.ts'],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off', 'max-params': 'off' },
  },

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
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/prefer-svelte-reactivity': 'warn',
    },
  },

  { files: ['**/*.mjs', '**/*.js'], languageOptions: { globals: { ...globals.node } } },
)
