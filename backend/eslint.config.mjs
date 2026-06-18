import js from '@eslint/js';
import boundariesPlugin from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint flat config — TypeScript recommended + DESIGN §3.4 hexagonal boundary
 * enforcement for bounded contexts.
 *
 * Boundary rules are scoped to `src/contexts/**` (and `src/shared/**`). Root
 * foundation files (main, AppModule, config, logger, health controller,
 * exception filter) are the bootstrap/infrastructure shell and are
 * intentionally outside the bounded-context boundary rules; the architecture
 * portfolio test (BF-09) mirrors this scope.
 *
 * Module resolution uses `eslint-import-resolver-typescript` so extensionless
 * `.ts` imports are classified correctly by `boundaries/element-types`.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'eslint.config.mjs',
      'prisma/migrations/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
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

  // DESIGN §3.4 — dependency direction between context layers.
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries: boundariesPlugin },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': [
        { type: 'shared', mode: 'file', pattern: 'src/shared/**/*.ts' },
        { type: 'domain', mode: 'file', pattern: 'src/contexts/*/domain/**/*.ts' },
        { type: 'application', mode: 'file', pattern: 'src/contexts/*/application/**/*.ts' },
        {
          type: 'infrastructure',
          mode: 'file',
          pattern: 'src/contexts/*/infrastructure/**/*.ts',
        },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'domain', allow: ['domain', 'shared'] },
            { from: 'application', allow: ['application', 'domain', 'shared'] },
            {
              from: 'infrastructure',
              allow: ['infrastructure', 'application', 'domain', 'shared'],
            },
            { from: 'shared', allow: ['shared'] },
          ],
        },
      ],
    },
  },

  // DESIGN §3.4 rule 1 — domain must not import frameworks or node: built-ins.
  // (Deep "no external imports" is reinforced by the BF-09 portfolio test; this
  //  catches the obvious offenders at lint time.)
  {
    files: ['src/contexts/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@nestjs/common', message: 'Domain layer must not import NestJS.' },
            { name: '@nestjs/core', message: 'Domain layer must not import NestJS.' },
            { name: '@prisma/client', message: 'Domain layer must not import Prisma.' },
            { name: 'prisma', message: 'Domain layer must not import Prisma.' },
            { name: 'express', message: 'Domain layer must not import Express.' },
            { name: 'rxjs', message: 'Domain layer must not import RxJS.' },
            { name: 'pino', message: 'Domain layer must not import pino.' },
          ],
          patterns: [
            {
              group: ['@nestjs/*', '@prisma/*'],
              message: 'Domain layer must not import framework packages.',
            },
            {
              group: ['node:*'],
              message:
                'Domain layer must not import node: built-ins (use globalThis APIs).',
            },
          ],
        },
      ],
    },
  },

  // DESIGN §3.4 rule 3 — HTTP decorators only inside context infrastructure.
  {
    files: ['src/contexts/**/*.ts'],
    ignores: ['src/contexts/*/infrastructure/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Decorator[expression.callee.name=/^(Controller|Get|Post|Put|Patch|Delete|All|Head|Options)$/] , Decorator[expression.name=/^(Controller|Get|Post|Put|Patch|Delete|All|Head|Options)$/]',
          message:
            'HTTP decorators are only allowed in src/contexts/*/infrastructure/.',
        },
      ],
    },
  },
);
