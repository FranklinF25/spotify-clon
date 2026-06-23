import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';

import { AppModule } from '../../src/app.module';
import { runSeed } from '../../prisma/seed';
import { startTestDb, type TestDbContext } from './test-db';

/**
 * Shared e2e fixture for the catalog HTTP flow (CAT-PR2b2-01).
 *
 * Boots a real Postgres 16 container, applies every Prisma migration, seeds
 * the canonical catalog fixture (5 artists × 10 albums × 40 tracks via
 * {@link runSeed}), and stands up the full AppModule (CatalogModule +
 * AuthModule + PrismaModule) behind Supertest.
 *
 * Each e2e file calls {@link startCatalogE2E} once in `beforeAll` (one
 * container per file, isolated process.env per Vitest worker) and
 * {@link CatalogE2eContext.cleanup} in `afterAll`.
 *
 * Catalog endpoints are read-only at runtime, so specs do NOT truncate
 * between tests — the seed fixture stays put for the lifetime of the
 * container. {@link CatalogE2eContext.resetCatalog} is provided for the rare
 * test that needs to wipe + re-seed explicitly.
 *
 * Auth tokens: catalog routes are JWT-guarded, so specs register a user via
 * the identity API and reuse the access token. {@link registerUser} wraps the
 * register call so sibling specs share the helper (CAT-PR2b2-02 refactor
 * note).
 */
export interface CatalogE2eContext {
  app: INestApplication;
  prisma: PrismaClient;
  db: TestDbContext;
  /** Truncate every table (catalog + identity) and re-seed the canonical fixture. */
  resetCatalog: () => Promise<void>;
  cleanup: () => Promise<void>;
}

/** Fixed e2e JWT secrets so specs can craft malformed/expired tokens with the same signer. */
export const E2E_ACCESS_SECRET = 'a'.repeat(48);
export const E2E_REFRESH_SECRET = 'b'.repeat(48);

/**
 * Boot a fresh Postgres 16 container, seed the canonical catalog dataset,
 * and stand up the AppModule on Supertest.
 *
 * Env vars MUST be set before the testing module compiles — `PrismaModule`'s
 * factory + identity's `IDENTITY_CONFIG` both call `loadConfig()` at provider
 * construction time and read `process.env.DATABASE_URL` / JWT secrets.
 */
export async function startCatalogE2E(): Promise<CatalogE2eContext> {
  const db = await startTestDb();

  process.env.DATABASE_URL = db.connectionString;
  process.env.JWT_ACCESS_SECRET = E2E_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = E2E_REFRESH_SECRET;
  process.env.JWT_ISSUER = 'spotify-clon';
  process.env.JWT_AUDIENCE = 'spotify-clon-users';

  // Seed the canonical catalog dataset (5 × 10 × 40) BEFORE the app boots so
  // every read-only spec sees the same fixture set on the first request.
  // `runSeed` writes via `db.prisma` (already connected to the container);
  // AppModule's own PrismaClient lands on the same DATABASE_URL so it reads
  // the seeded rows.
  await runSeed(db.prisma);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(cookieParser());
  await app.init();

  return {
    app,
    prisma: db.prisma,
    db,
    resetCatalog: async () => {
      await db.truncate();
      await runSeed(db.prisma);
    },
    cleanup: async () => {
      await app.close();
      await db.cleanup();
    },
  };
}

/**
 * Register a user via the identity HTTP API and return the access token.
 *
 * Catalog specs call this once in `beforeAll` (after {@link startCatalogE2E})
 * to obtain a Bearer token for the class-level `JwtAuthGuard` on
 * `CatalogController`. Each spec passes the token via
 * `request(app.getHttpServer()).get(...).set('Authorization', \`Bearer ${token}\`)`
 * — one-shot supertest, no cookie jar (per the session carry-over learning
 * from identity's refresh spec, where the cookie jar silently overrode a
 * manual `Cookie` header).
 */
export async function registerUser(
  app: INestApplication,
  email: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName: email.split('@')[0] });
  return res.body.accessToken as string;
}
