import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

/**
 * testcontainers-backed Postgres 16 fixture for infrastructure and e2e specs.
 *
 * One container per test file (spin it up in `beforeAll`, stop it in
 * `afterAll`). The Prisma migration `0000_init` is applied once during
 * bootstrap; between tests call {@link TestDbContext.truncate} to reset the
 * tables (RESTART IDENTITY CASCADE) so every spec starts from a clean slate
 * without paying the container/migration cost again.
 *
 * Fidelity rationale (DESIGN §6.1): using a real Postgres 16 catches issues
 * that an in-memory sqlite would hide — `gen_random_uuid()`, TIMESTAMPTZ
 * semantics, the FK cascade on `refresh_tokens.user_id`, and the unique
 * constraints on `users.email` / `refresh_tokens.jti`.
 */
export interface TestDbContext {
  /** Connected Prisma client bound to the container's DATABASE_URL. */
  prisma: PrismaClient;
  /** The live container handle (exposed so specs can read host/port if needed). */
  container: StartedPostgreSqlContainer;
  /** Connection string the PrismaClient uses — specs set this on `process.env` before booting Nest. */
  connectionString: string;
  /** Wipe identity tables so the next test sees an empty DB. */
  truncate: () => Promise<void>;
  /** Disconnect the client and stop the container. */
  cleanup: () => Promise<void>;
}

/**
 * Boot a fresh Postgres 16 container, apply the Prisma migration, and return a
 * connected client plus helpers. Always pair with {@link TestDbContext.cleanup}
 * in `afterAll` to avoid leaking containers.
 */
export async function startTestDb(): Promise<TestDbContext> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const connectionString = container.getConnectionUri();

  // Apply the initial migration directly via Prisma raw execution. Spawning
  // the `prisma` CLI is avoided on purpose: it is slower per test file and,
  // in some pnpm/WSL setups, the `pnpm exec` wrapper performs a deps-status
  // check that crashes. The migration SQL is split into individual statements
  // because Postgres drivers do not accept multi-statement queries in one
  // `$executeRawUnsafe` call.
  const prisma = new PrismaClient({
    datasources: { db: { url: connectionString } },
  });
  await prisma.$connect();
  await applyMigration(prisma);

  return {
    prisma,
    container,
    connectionString,
    truncate: async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "refresh_tokens", "users" RESTART IDENTITY CASCADE;',
      );
    },
    cleanup: async () => {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}

/**
 * Read `prisma/migrations/0000_init/migration.sql` and execute each statement
 * individually. The location is resolved relative to the backend project root
 * (the cwd under Vitest), so the helper works from any spec that imports it.
 *
 * Statements are split on `;` followed by a newline — sufficient for the DDL in
 * `0000_init`, which contains no semicolons inside strings or function bodies.
 */
async function applyMigration(prisma: PrismaClient): Promise<void> {
  const migrationPath = resolve(process.cwd(), 'prisma/migrations/0000_init/migration.sql');
  const sql = readFileSync(migrationPath, 'utf8');
  const statements = sql
    .split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

