import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', '.data-cache/', 'playwright-report/', 'test-results/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}', 'tests/**/*.{ts,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Build-time scripts report progress on the console.
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
