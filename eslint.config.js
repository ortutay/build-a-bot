import globals from 'globals';
import pluginJs from '@eslint/js';
import pluginPromise from 'eslint-plugin-promise';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    languageOptions: {
      globals: {
        ...globals.node,
        test: 'readonly',
        it: 'readonly',
        xtest: 'readonly',
        xit: 'readonly',
        fit: 'readonly',
        describe: 'readonly',
        xdescribe: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        DOMException: 'readonly',
      },
    },
    plugins: {
      promise: pluginPromise,
    },
    rules: {
      ...pluginPromise.configs.recommended.rules,
      'promise/catch-or-return': 'error',
      'promise/always-return': 'off',
      'promise/param-names': 'off',
      'promise/no-nesting': 'off',
    },
  },
  pluginJs.configs.recommended,
];
