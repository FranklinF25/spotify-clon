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
 * Each project has at least one example so `npm test` demonstrates every layer.
 */
export default defineConfig({
  test: {
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
          include: ['test/examples/infrastructure.example.spec.ts', '**/*.integration-spec.ts'],
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
          include: ['test/architecture.spec.ts'],
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
