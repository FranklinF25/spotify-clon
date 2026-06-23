import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';

import { AppModule } from '../../src/app.module';
import { startTestDb, type TestDbContext } from './test-db';

/**
 * Shared e2e fixture for the identity HTTP flow: boots a real Postgres 16
 * container, points the env at it, and stands up the full AppModule
 * (AppModule → AuthModule → real Prisma/argon2/JWT adapters) behind Supertest.
 *
 * Each e2e file calls {@link bootAuthApp} once in `beforeAll` (one container per
 * file, isolated process.env per Vitest worker) and {@link cleanup} in `afterAll`.
 * `truncate` resets the identity tables between tests inside a file.
 */
export interface AuthE2eContext {
  app: INestApplication;
  db: TestDbContext;
  truncate: () => Promise<void>;
  cleanup: () => Promise<void>;
}

/** Fixed e2e secrets so specs can craft tokens (e.g. an expired refresh) with the same signer. */
export const E2E_ACCESS_SECRET = 'a'.repeat(48);
export const E2E_REFRESH_SECRET = 'b'.repeat(48);

export async function bootAuthApp(): Promise<AuthE2eContext> {
  const db = await startTestDb();

  // Env must be set before the module compiles — AppModule + AuthModule both
  // call loadConfig() at provider-construction time.
  process.env.DATABASE_URL = db.connectionString;
  process.env.JWT_ACCESS_SECRET = E2E_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = E2E_REFRESH_SECRET;
  process.env.JWT_ISSUER = 'spotify-clon';
  process.env.JWT_AUDIENCE = 'spotify-clon-users';
  // Required by AppConfig (PR-1 added AUDIO_STORAGE_PATH as a fail-fast
  // field). The identity e2e suite does NOT exercise playback; the
  // placeholder is just enough to let AppConfig boot. PR-2's playback
  // e2e helper will set this to a real fixtures path.
  process.env.AUDIO_STORAGE_PATH = '/tmp/playback-unused';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(cookieParser());
  await app.init();

  return {
    app,
    db,
    truncate: db.truncate,
    cleanup: async () => {
      await app.close();
      await db.cleanup();
    },
  };
}
