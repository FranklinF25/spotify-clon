import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { statSync } from 'node:fs';

import { AppModule } from '../../src/app.module';
import { startTestDb, type TestDbContext } from './test-db';

/**
 * Shared e2e fixture for the playback HTTP flow (PB-PR2-10).
 *
 * Boots a real Postgres 16 container, applies every Prisma migration,
 * seeds a single known track row whose `filePath` resolves to the
 * committed fixture mp3 (`backend/test/fixtures/audio/sample.mp3`),
 * and stands up the full AppModule (PlaybackModule + AuthModule +
 * CatalogModule + PrismaModule) behind Supertest.
 *
 * AUDIO_STORAGE_PATH is set to the PARENT of the fixtures' `audio/`
 * subdir (C8 fix from Judgment Day). `FsAudioStorage.resolve` strips
 * the leading `/` from the seed-style `/audio/sample.mp3` path, so
 * `path.resolve(AUDIO_STORAGE_PATH, 'audio/sample.mp3')` lands at
 * `<AUDIO_STORAGE_PATH>/audio/sample.mp3`. With `AUDIO_STORAGE_PATH`
 * = `backend/test/fixtures`, that resolves to
 * `backend/test/fixtures/audio/sample.mp3` — exactly where the
 * committed fixture lives.
 *
 * Each e2e file calls {@link startPlaybackE2E} once in `beforeAll` (one
 * container per file, isolated process.env per Vitest worker) and
 * {@link PlaybackE2eContext.cleanup} in `afterAll`.
 */
export interface PlaybackE2eContext {
  app: INestApplication;
  prisma: PrismaClient;
  db: TestDbContext;
  /** The seeded track id specs hit. */
  trackId: string;
  /** The seeded track's file size in bytes (used for Content-Length assertions). */
  trackSize: number;
  /** The seeded track's stored filePath (used for the leak-leak assertion). */
  filePath: string;
  cleanup: () => Promise<void>;
}

/** Fixed e2e JWT secrets so specs can craft malformed tokens with the same signer. */
export const E2E_ACCESS_SECRET = 'a'.repeat(48);
export const E2E_REFRESH_SECRET = 'b'.repeat(48);

/**
 * Boot a Fresh Postgres 16 container, seed a single playback test track,
 * and stand up the AppModule on Supertest.
 *
 * Env vars MUST be set before the testing module compiles — `PrismaModule`'s
 * factory + identity's `IDENTITY_CONFIG` + `AppModule`'s `ENV_CONFIG` all
 * call `loadConfig()` at provider-construction time and read
 * `process.env.DATABASE_URL` / JWT secrets / `AUDIO_STORAGE_PATH`.
 */
export async function startPlaybackE2E(): Promise<PlaybackE2eContext> {
  const db = await startTestDb();

  process.env.DATABASE_URL = db.connectionString;
  process.env.JWT_ACCESS_SECRET = E2E_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = E2E_REFRESH_SECRET;
  process.env.JWT_ISSUER = 'spotify-clon';
  process.env.JWT_AUDIENCE = 'spotify-clon-users';
  // C8 fix — set AUDIO_STORAGE_PATH to the PARENT of the fixtures'
  // `audio/` subdir so `FsAudioStorage.resolve('/audio/sample.mp3')`
  // lands at `<AUDIO_STORAGE_PATH>/audio/sample.mp3` (the committed
  // fixture location). Setting this to the `audio/` dir itself would
  // double the segment to `<root>/audio/audio/sample.mp3` and never
  // find a file.
  process.env.AUDIO_STORAGE_PATH = resolve(__dirname, '..', 'fixtures');

  // Seed a single track row whose `filePath` matches the fixture layout.
  // The track id is fixed (deterministic) so e2e specs have a stable id
  // to hit; the album + artist rows are required by the FK constraint.
  const trackId = '00000000-0000-0000-0000-0000000000a1';
  const albumId = '00000000-0000-0000-0000-0000000000b1';
  const artistId = '00000000-0000-0000-0000-0000000000c1';
  const filePath = '/audio/sample.mp3';
  // Fixtures live at `backend/test/fixtures/audio/sample.mp3` — sibling of
  // `backend/test/helpers/` (this file's dir).
  const fixturePath = resolve(__dirname, '..', 'fixtures', 'audio', 'sample.mp3');
  const trackSize = statSync(fixturePath).size;

  await db.prisma.$executeRaw`
    INSERT INTO "artists" ("id", "name", "bio", "image_url")
    VALUES (${artistId}::uuid, ${'Playback Test Artist'}, NULL, NULL)
  `;
  await db.prisma.$executeRaw`
    INSERT INTO "albums" ("id", "title", "release_year", "cover_url", "artist_id")
    VALUES (${albumId}::uuid, ${'Playback Test Album'}, NULL, NULL, ${artistId}::uuid)
  `;
  await db.prisma.$executeRaw`
    INSERT INTO "tracks" ("id", "title", "duration_seconds", "file_path", "track_number", "album_id")
    VALUES (
      ${trackId}::uuid,
      ${'Sample Track'},
      ${4},
      ${filePath},
      ${1},
      ${albumId}::uuid
    )
  `;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(cookieParser());
  await app.init();

  return {
    app,
    prisma: db.prisma,
    db,
    trackId,
    trackSize,
    filePath,
    cleanup: async () => {
      await app.close();
      await db.cleanup();
    },
  };
}

/**
 * Register a user via the identity HTTP API and return the access token.
 *
 * Playback routes are JWT-guarded, so specs register a user once in
 * `beforeAll` (after {@link startPlaybackE2E}) to obtain a Bearer token
 * for the class-level `JwtAuthGuard` on `PlaybackController`.
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
