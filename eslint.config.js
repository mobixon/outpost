import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', '.pnpm-store/', 'local/']),
  js.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Built-in modules must prove that the public packages are enough to write a plugin.
    files: ['plugins/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/apps/**',
                '@outpost/server',
                '@outpost/server/*',
                '@outpost/web',
                '@outpost/web/*',
              ],
              message:
                'Plugins may only import public packages: @outpost/plugin-api, @outpost/web-plugin-api, @outpost/shared, @outpost/ui.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
