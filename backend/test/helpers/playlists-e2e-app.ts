import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';

import { AppModule } from '../../src/app.module';
import { startTestDb, type TestDbContext } from './test-db';
import { E2E_ACCESS_SECRET, E2E_REFRESH_SECRET } from './playback-e2e-app';

/**
 * Shared e2e fixture for the playlists HTTP suite (F5 — PR-2 WORK-PR2-03..05).
 *
 * Mirrors `backend/test/helpers/playback-e2e-app.ts` line-for-line in
 * structure: boots a Postgres 16 testcontainer via {@link startTestDb},
 * applies every Prisma migration (including `0002_playlists`), sets the JWT
 * + AppConfig env vars BEFORE compiling the testing module, seeds the catalog
 * FK targets (1 artist, 1 album, 4 tracks with deterministic UUIDs), and
 * registers two real identity users (`U1`, `U2`) via the HTTP API so their
 * access tokens are interchangeable with the playback fixture's.
 *
 * JWT secret reuse (DESIGN §11 — single source of truth): the
 * `E2E_ACCESS_SECRET` / `E2E_REFRESH_SECRET` constants are imported from the
 * playback helper rather than redefined. Both helpers use the same
 * `'a'.repeat(48)` / `'b'.repeat(48)` values so tokens minted here validate
 * against the same `JwtAuthGuard`.
 *
 * `AUDIO_STORAGE_PATH` is required by `AppConfig` (`z.string().min(1)` in
 * `src/config.ts`) but the playlists e2e suite NEVER streams audio — a
 * placeholder path satisfies the config validator without pointing at a real
 * fixtures directory.
 *
 * One container per spec file: `beforeAll` boots (120s timeout like playback),
 * `afterAll` calls `cleanup`.
 */

/** Token + user id for one registered user. */
export interface PlaylistUserContext {
  /** The user's UUID (from `POST /auth/register` response `user.id`). */
  id: string;
  /** The JWT access token (from `POST /auth/register` response `accessToken`). */
  token: string;
}

export interface PlaylistsE2eContext {
  app: INestApplication;
  prisma: PrismaClient;
  db: TestDbContext;
  tokens: {
    U1: PlaylistUserContext;
    U2: PlaylistUserContext;
  };
  /** Seeded catalog track UUIDs (`T1`=`...0001`, `T2`=`...0002`, `T3`=`...0003`, `T4`=`...0004`). */
  trackIds: string[];
  cleanup: () => Promise<void>;
}

/**
 * Boot a Postgres 16 container, seed the catalog FK targets, register two
 * identity users, and stand up the full AppModule (PlaylistsModule +
 * AuthModule + CatalogModule + PrismaModule) behind Supertest.
 *
 * Env vars MUST be set before the testing module compiles — `PrismaModule`'s
 * factory + identity's `IDENTITY_CONFIG` + `AppModule`'s `ENV_CONFIG` all
 * call `loadConfig()` at provider-construction time and read
 * `process.env.DATABASE_URL` / JWT secrets / `AUDIO_STORAGE_PATH`.
 */
export async function startPlaylistsE2E(): Promise<PlaylistsE2eContext> {
  const db = await startTestDb();

  process.env.DATABASE_URL = db.connectionString;
  process.env.JWT_ACCESS_SECRET = E2E_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = E2E_REFRESH_SECRET;
  process.env.JWT_ISSUER = 'spotify-clon';
  process.env.JWT_AUDIENCE = 'spotify-clon-users';
  // AppConfig requires a non-empty AUDIO_STORAGE_PATH, but the playlists e2e
  // never streams audio — placeholder satisfies the validator.
  process.env.AUDIO_STORAGE_PATH = '/tmp/playlists-e2e-unused';

  // Seed catalog FK targets — 1 artist, 1 album, 4 tracks with deterministic
  // UUIDs. `playlist_tracks.track_id` has ON DELETE RESTRICT (migration
  // 0002_playlists), so every track added to a playlist MUST resolve to one
  // of these rows. The add-track use case also validates via
  // `catalog.findTrackByIds` before insert (422 on unknown).
  //
  // 4 tracks (not 3) because the reorder scenarios (REQ-P-010) exercise
  // [A,B,C,D] four-row orderings.
  const artistId = '00000000-0000-0000-0000-0000000000c1';
  const albumId = '00000000-0000-0000-0000-0000000000b1';
  const trackIds = [
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
  ];

  await db.prisma.$executeRaw`
    INSERT INTO "artists" ("id", "name", "bio", "image_url")
    VALUES (${artistId}::uuid, ${'Playlists Test Artist'}, NULL, NULL)
  `;
  await db.prisma.$executeRaw`
    INSERT INTO "albums" ("id", "title", "release_year", "cover_url", "artist_id")
    VALUES (${albumId}::uuid, ${'Playlists Test Album'}, NULL, NULL, ${artistId}::uuid)
  `;
  for (let i = 0; i < trackIds.length; i++) {
    await db.prisma.$executeRaw`
      INSERT INTO "tracks" ("id", "title", "duration_seconds", "file_path", "track_number", "album_id")
      VALUES (
        ${trackIds[i]}::uuid,
        ${`Track ${i + 1}`},
        ${120 + i},
        ${`/audio/track-${i + 1}.mp3`},
        ${i + 1},
        ${albumId}::uuid
      )
    `;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(cookieParser());
  await app.init();

  // Register two users via the identity HTTP API so JWTs are real and the
  // user rows exist for the `playlists.user_id` FK.
  const U1 = await registerUser(app, 'playlists-u1@example.com');
  const U2 = await registerUser(app, 'playlists-u2@example.com');

  return {
    app,
    prisma: db.prisma,
    db,
    tokens: { U1, U2 },
    trackIds,
    cleanup: async () => {
      await app.close();
      await db.cleanup();
    },
  };
}

/**
 * Register a user via the identity HTTP API and return both the user id and
 * the access token.
 *
 * Richer than playback's `registerUser` (token-only) because playlist specs
 * assert `userId === U1.id` on every create/get response and need the id to
 * seed direct-prisma ownership assertions (e.g. the REQ-P-011 no-write-
 * occurred verifications).
 *
 * Email uniqueness is per-container; callers minting extra users (e.g. `U3`
 * for the REQ-P-003 empty-list scenario) MUST use a distinct email.
 */
export async function registerUser(
  app: INestApplication,
  email: string,
): Promise<PlaylistUserContext> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName: email.split('@')[0] });
  return {
    id: res.body.user.id as string,
    token: res.body.accessToken as string,
  };
}
