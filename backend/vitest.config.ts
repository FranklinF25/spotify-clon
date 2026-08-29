import { defineConfig } from 'vitest/config';

/**
 * Vitest harness with four projects, one per testing concern:
 *
 * - `unit`         domain + application layer specs (pure, framework-agnostic)
 *                  plus src-level unit specs (config, logger, ...).
 * - `integration`  infrastructure layer specs (adapter mappings now; real
 *                  testcontainers-Postgres integration specs in PR-3).
 * - `e2e`          full HTTP pipeline specs (Supertest + Nest TestingModule).
 * - `architecture` portfolio guard enforcing DESIGN §3.4 (expanded in BF-09).
 *
 * Each project has at least one example so `pnpm test` demonstrates every layer.
 *
 * The top-level `include` widens Vitest's default collection (which only
 * matches `*.spec.ts` / `*.test.ts`) so the DESIGN naming convention is
 * honoured: `*.spec.ts` unit, `*.integration-spec.ts` infra, `*.e2e-spec.ts`
 * HTTP. Each project then narrows that set with its own `include`.
 */
export default defineConfig({
  test: {
    include: ['**/*.spec.ts', '**/*.integration-spec.ts', '**/*.e2e-spec.ts'],
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'src/**/*.spec.ts',
            'test/examples/domain.example.spec.ts',
            'test/examples/application.example.spec.ts',
          ],
          setupFiles: ['test/vitest.setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: [
            'test/examples/infrastructure.example.spec.ts',
            '**/*.integration-spec.ts',
            'prisma/**/*.spec.ts',
          ],
          setupFiles: ['test/vitest.setup.ts'],
        },
      },
      {
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['test/e2e/**/*.spec.ts'],
          setupFiles: ['test/vitest.setup.ts'],
          testTimeout: 15_000,
        },
      },
      {
        test: {
          name: 'architecture',
          environment: 'node',
          // `lint-rules.spec.ts` joins `architecture.spec.ts` here because
          // both are portfolio-level regression guards (DESIGN §3.4 + §6
          // rule contracts). The lint-rules spec is NOT a unit test (it
          // drives the real ESLint flat config via the `ESLint` API).
          // The two openapi specs are the same kind of guard for the API
          // reference (API-DOC): route coverage is a ts-morph scan + exact
          // set match against the generated document; document shape pins
          // the bearer scheme, context tags, multipart upload, and the
          // error-code enum mirror.
          include: [
            'test/architecture.spec.ts',
            'test/lint-rules.spec.ts',
            'test/openapi-coverage.spec.ts',
            'test/openapi-document.spec.ts',
          ],
          setupFiles: ['test/vitest.setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.integration-spec.ts', '**/*.e2e-spec.ts', 'src/main.ts'],
    },
  },
});
