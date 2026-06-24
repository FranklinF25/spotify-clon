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
  //
  // CRIT-2 (Judgment Day R2): migrated from stock `no-restricted-imports` to
  // `@typescript-eslint/no-restricted-imports` so `allowTypeImports: true` can
  // be set on the `node:*` pattern. The domain `types.ts` needs
  // `import type { Readable } from 'node:stream'` (compile-time erased —
  // `AudioStream = Readable` type alias). Stock `no-restricted-imports` does
  // NOT distinguish `import type` from runtime imports; the typescript-eslint
  // variant does. Only `node:*` opens for type-only imports — type-only
  // imports from `@nestjs/*`, `@prisma/*`, `express`, `rxjs`, `pino` stay
  // banned (domain stays framework-free even at the type level per REQ-BF-009
  // scenario "Domain type-only imports from non-node specifiers are blocked").
  {
    files: ['src/contexts/*/domain/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
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
                'Domain layer must not import node: built-ins at runtime (use globalThis APIs).',
              // Type-only imports from node:* are permitted (erased at compile
              // time → no runtime contamination). Required by playback's
              // `AudioStream = Readable` alias.
              allowTypeImports: true,
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

  // ---------------------------------------------------------------------------
  // Cross-context concrete-adapter ban (PB-PR3-01 / PB-PR2-12, REQ-BF-009).
  //
  // The first cross-context edge in the portfolio is playback → catalog.
  // Playback MUST consume `CatalogRepositoryPort` via the
  // `CATALOG_REPOSITORY_PORT` Symbol token (exported additively by
  // `CatalogModule` per PB-PR2-02), NEVER the concrete
  // `PrismaCatalogRepository` adapter directly. This rule makes any direct
  // import of the concrete adapter a lint error in every non-catalog,
  // non-domain context file.
  //
  // CRIT-1 (Judgment Day R2): stock `no-restricted-imports` has no from-file
  // context awareness — it pattern-matches the literal import specifier
  // string. The codebase uses RELATIVE specifiers
  // (`'../../catalog/infrastructure/prisma-catalog.repository'`), so the
  // `group` glob uses `**/catalog/infrastructure/prisma-catalog.repository`
  // which the `ignore` library (used internally by ESLint) matches against
  // the relative specifier via gitignore-style glob semantics. This was
  // verified in PR-3's lint-fixture test (`test/lint-rules.spec.ts`).
  //
  // WARN-overlap (DESIGN §6): the `ignores` array exempts (a) catalog's own
  // tree — catalog is the OWNER of its concrete adapter and may use it
  // freely — and (b) every context's `domain/` tree — the domain rule from
  // CRIT-2 (above) is stricter (`@typescript-eslint/no-restricted-imports`
  // with full `paths` + `patterns`) and would otherwise be shadowed by this
  // looser stock-`no-restricted-imports` block under flat-config's
  // "later-rule-wins" semantics.
  //
  // Catalog's existing `JwtAuthGuard` import from identity stays LEGAL here:
  // it is governed by the existing `boundaries/element-types` rule above
  // (infrastructure → infrastructure is allowed), NOT by this rule. The
  // concrete-adapter ban targets ONLY the catalog repository adapter.
  // -------------------------------------------------------------------------
  {
    files: ['src/contexts/**/*.ts'],
    ignores: [
      // catalog owns its concrete adapter — may wire it internally.
      'src/contexts/catalog/**/*.ts',
      // domain has its own stricter rule (CRIT-2 above) — keep these
      // disjoint so flat-config "later rule wins" doesn't shadow it.
      'src/contexts/*/domain/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Glob pattern matches relative import specifiers like
              // '../../catalog/infrastructure/prisma-catalog.repository'
              // (ESLint delegates to the `ignore` library which applies
              // gitignore-style glob matching, not literal string equality).
              group: ['**/catalog/infrastructure/prisma-catalog.repository'],
              message:
                'Consumers must depend on the CATALOG_REPOSITORY_PORT token (injected via DI), not the concrete adapter. Cross-context coupling goes through ports.',
            },
          ],
        },
      ],
    },
  },
);
