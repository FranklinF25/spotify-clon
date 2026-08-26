import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppModule } from '../../src/app.module';
import { startTestDb, type TestDbContext } from './test-db';

/**
 * Shared e2e fixture for the upload HTTP flow (REQ-UPLOAD-001).
 *
 * Boots a real Postgres 16 container (migrations applied by `startTestDb`)
 * and stands up the full AppModule — CatalogModule now carries the upload
 * write path (writer adapter + UploadTrackUseCase) — behind Supertest.
 *
 * The audio root is a THROWAWAY temp dir per file, not the committed
 * playback fixtures: uploads must actually WRITE (the playback helper's
 * fixtures tree stays pristine and read-only). `AUDIO_STORAGE_PATH` points
 * at the temp PARENT (C8 convention: the value is the parent of `audio/`),
 * so `FsAudioFileWriter` writes land under `<tmp>/audio/` — the same root
 * a real `FsAudioStorage` would stream from in this process.
 *
 * No catalog fixture is inserted: the upload flow CREATES its own rows
 * (that is the feature under test), so the database starts empty.
 *
 * Each e2e file calls {@link startUploadE2E} once in `beforeAll` (one
 * container per file, isolated process.env per Vitest worker) and
 * {@link UploadE2eContext.cleanup} in `afterAll` — cleanup removes the
 * temp audio tree along with the container.
 */
export interface UploadE2eContext {
  app: INestApplication;
  prisma: PrismaClient;
  db: TestDbContext;
  /** The scratch audio root uploads land under (`<tmp>/audio`). */
  audioRoot: string;
  cleanup: () => Promise<void>;
}

/** Fixed e2e JWT secrets so specs can craft malformed tokens with the same signer. */
export const E2E_ACCESS_SECRET = 'a'.repeat(48);
export const E2E_REFRESH_SECRET = 'b'.repeat(48);

export async function startUploadE2E(): Promise<UploadE2eContext> {
  const db = await startTestDb();
  const storagePath = await fs.mkdtemp(join(tmpdir(), 'upload-e2e-'));

  // Env must be set before the module compiles — ConfigModule's ENV_CONFIG
  // factory calls loadConfig() at provider-construction time and reads
  // process.env.DATABASE_URL / JWT secrets / AUDIO_STORAGE_PATH.
  process.env.DATABASE_URL = db.connectionString;
  process.env.JWT_ACCESS_SECRET = E2E_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = E2E_REFRESH_SECRET;
  process.env.JWT_ISSUER = 'spotify-clon';
  process.env.JWT_AUDIENCE = 'spotify-clon-users';
  // C8 convention — the PARENT of the audio dir. FsAudioFileWriter joins
  // 'audio' itself, so uploads land at <storagePath>/audio/<filename>.
  process.env.AUDIO_STORAGE_PATH = storagePath;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(cookieParser());
  await app.init();

  return {
    app,
    prisma: db.prisma,
    db,
    audioRoot: join(storagePath, 'audio'),
    cleanup: async () => {
      await app.close();
      await db.cleanup();
      await fs.rm(storagePath, { recursive: true, force: true });
    },
  };
}

/**
 * Register a user via the identity HTTP API and return the access token.
 *
 * Upload routes are JWT-guarded (REQ-UPLOAD-001: 401 unauthenticated), so
 * specs register a user once in `beforeAll` (after {@link startUploadE2E})
 * to obtain a Bearer token for the class-level `JwtAuthGuard` on
 * `CatalogController`. Mirrors the catalog/playback helper convention.
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
