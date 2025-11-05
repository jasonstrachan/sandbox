import js from '@eslint/js';
import globals from 'globals';

const sharedLanguageOptions = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  globals: {
    ...globals.browser,
    ...globals.node,
  },
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: sharedLanguageOptions,
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
    },
  },
];
