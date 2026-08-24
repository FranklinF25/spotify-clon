import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';

import { AppModule } from '../../src/app.module';
import { startTestDb, type TestDbContext } from './test-db';
import { E2E_ACCESS_SECRET, E2E_REFRESH_SECRET } from './playback-e2e-app';

/**
 * Shared e2e fixture for the library HTTP suite (F6 — WORK-PR2-03/04).
 *
 * Mirrors `playlists-e2e-app.ts` line-for-line in structure: boots a
 * Postgres 16 testcontainer via {@link startTestDb} (applying every
 * migration including `0003_library`), sets the JWT + AppConfig env vars
 * BEFORE compiling the testing module, seeds the catalog FK targets
 * (1 artist, 4 albums with deterministic UUIDs — the scenario matrix needs
 * THREE ordered saves for REQ-L-003 recency plus one existing-never-saved
 * album for REQ-L-004 idempotency), and registers two real identity users
 * (`U1`, `U2`) via the HTTP API.
 *
 * One container per spec file: `beforeAll` boots (120s timeout like
 * playback/playlists), `afterAll` calls `cleanup`.
 */

/** Token + user id for one registered user. */
export interface LibraryUserContext {
  /** The user's UUID (from `POST /auth/register` response `user.id`). */
  id: string;
  /** The JWT access token (from `POST /auth/register` response `accessToken`). */
  token: string;
}

export interface LibraryE2eContext {
  app: INestApplication;
  prisma: PrismaClient;
  db: TestDbContext;
  tokens: {
    U1: LibraryUserContext;
    U2: LibraryUserContext;
  };
  /**
   * Seeded catalog album UUIDs, `added_at`-agnostic:
   * `A1`=`...0001`, `A2`=`...0002`, `A3`=`...0003` (recency trio) +
   * `A9`=`...0009` (exists in catalog, never saved — REQ-L-004 idempotency).
   */
  albumIds: { A1: string; A2: string; A3: string; A9: string };
  cleanup: () => Promise<void>;
}

/**
 * Boot a Postgres 16 container, seed the catalog FK targets, register two
 * identity users, and stand up the full AppModule (LibraryModule +
 * AuthModule + CatalogModule + PrismaModule) behind Supertest.
 *
 * Env vars MUST be set before the testing module compiles — every config
 * provider calls `loadConfig()` at construction time and reads
 * `process.env.DATABASE_URL` / JWT secrets / `AUDIO_STORAGE_PATH`.
 */
export async function libraryE2eApp(): Promise<LibraryE2eContext> {
  const db = await startTestDb();

  process.env.DATABASE_URL = db.connectionString;
  process.env.JWT_ACCESS_SECRET = E2E_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = E2E_REFRESH_SECRET;
  process.env.JWT_ISSUER = 'spotify-clon';
  process.env.JWT_AUDIENCE = 'spotify-clon-users';
  // AppConfig requires a non-empty AUDIO_STORAGE_PATH; the library e2e
  // never streams audio — placeholder satisfies the validator.
  process.env.AUDIO_STORAGE_PATH = '/tmp/library-e2e-unused';

  // Seed catalog FK targets — 1 artist, 4 albums (deterministic UUIDs).
  // `user_library_albums.album_id` has ON DELETE CASCADE (0003_library) and
  // the add use case validates existence via `catalog.findAlbumByIds`
  // before insert (422 on unknown) — every saved album must resolve here.
  const artistId = '00000000-0000-0000-0000-0000000000c1';
  const albumIds = {
    A1: '00000000-0000-0000-0000-000000000001',
    A2: '00000000-0000-0000-0000-000000000002',
    A3: '00000000-0000-0000-0000-000000000003',
    A9: '00000000-0000-0000-0000-000000000009',
  };

  await db.prisma.$executeRaw`
    INSERT INTO "artists" ("id", "name", "bio", "image_url")
    VALUES (${artistId}::uuid, ${'Library Test Artist'}, NULL, NULL)
  `;
  for (const [label, id] of Object.entries(albumIds)) {
    await db.prisma.$executeRaw`
      INSERT INTO "albums" ("id", "title", "release_year", "cover_url", "artist_id")
      VALUES (${id}::uuid, ${`Library Test Album ${label}`}, ${2000 + Number(label[1])}, NULL, ${artistId}::uuid)
    `;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(cookieParser());
  await app.init();

  const U1 = await registerUser(app, 'library-u1@example.com');
  const U2 = await registerUser(app, 'library-u2@example.com');

  return {
    app,
    prisma: db.prisma,
    db,
    tokens: { U1, U2 },
    albumIds,
    cleanup: async () => {
      await app.close();
      await db.cleanup();
    },
  };
}

/** Register a user via the identity HTTP API; returns user id + access token. */
async function registerUser(
  app: INestApplication,
  email: string,
): Promise<LibraryUserContext> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName: email.split('@')[0] });
  return {
    id: res.body.user.id as string,
    token: res.body.accessToken as string,
  };
}
