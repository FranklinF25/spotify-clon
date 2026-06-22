import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

/**
 * testcontainers-backed Postgres 16 fixture for infrastructure and e2e specs.
 *
 * One container per test file (spin it up in beforeAll, stop it in afterAll).
 * Every Prisma migration under prisma/migrations is applied once during
 * bootstrap; between tests call TestDbContext.truncate to reset the tables
 * (RESTART IDENTITY CASCADE) so every spec starts from a clean slate without
 * paying the container/migration cost again.
 *
 * Fidelity rationale (DESIGN 6.1): using a real Postgres 16 catches issues
 * that an in-memory sqlite would hide — gen_random_uuid(), TIMESTAMPTZ
 * semantics, the FK cascade on refresh_tokens.user_id, the cascade FKs on
 * albums.artist_id and tracks.album_id, the generated tsvector columns, and
 * the unique constraints on users.email and refresh_tokens.jti.
 */
export interface TestDbContext {
  prisma: PrismaClient;
  container: StartedPostgreSqlContainer;
  connectionString: string;
  truncate: () => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * Boot a fresh Postgres 16 container, apply every Prisma migration in order,
 * and return a connected client plus helpers. Always pair with
 * TestDbContext.cleanup in afterAll to avoid leaking containers.
 */
export async function startTestDb(): Promise<TestDbContext> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const connectionString = container.getConnectionUri();

  // Apply migrations directly via Prisma raw execution. Spawning the prisma
  // CLI is avoided on purpose: it is slower per test file and, in some
  // pnpm/WSL setups, the pnpm exec wrapper performs a deps-status check that
  // crashes. The migration SQL is split into individual statements because
  // Postgres drivers do not accept multi-statement queries in one
  // $executeRawUnsafe call.
  const prisma = new PrismaClient({
    datasources: { db: { url: connectionString } },
  });
  await prisma.$connect();
  await applyMigrations(prisma);

  return {
    prisma,
    container,
    connectionString,
    truncate: async () => {
      // Catalog tables come first so the FK CASCADE has nothing to descend
      // into; identity tables follow. RESTART IDENTITY resets any sequence
      // (currently none — UUIDs are dbgenerated — but defensive).
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "tracks", "albums", "artists", "refresh_tokens", "users" RESTART IDENTITY CASCADE;',
      );
    },
    cleanup: async () => {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}

/**
 * Read every migration.sql under prisma/migrations (lexicographic order) and
 * execute each statement individually.
 *
 * Lexicographic sort on the folder name is correct because Prisma migration
 * folders use a zero-padded prefix (e.g. 0000_init, then 0001_catalog) so a
 * plain Array.prototype.sort produces the right order without parsing the
 * manifest.
 *
 * Statements are split on a semicolon followed by a newline — sufficient for
 * the DDL used by 0000_init and 0001_catalog, neither of which contains a
 * semicolon inside strings or function bodies.
 *
 * CO-catalog-4 (carry-over): this semicolon-newline splitter is fragile for
 * future migrations with PL/pgSQL bodies (semicolons inside BEGIN-END blocks).
 * It is kept deliberately for now; revisit when the first such migration lands.
 */
async function applyMigrations(prisma: PrismaClient): Promise<void> {
  const migrationsRoot = resolve(process.cwd(), 'prisma/migrations');
  const folders = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const sql = readFileSync(resolve(migrationsRoot, folder, 'migration.sql'), 'utf8');
    const statements = sql
      .split(/;\s*\n/)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
  }
}
