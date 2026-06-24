import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENV_CONFIG } from '../../../config.tokens';
import { GlobalExceptionFilter } from '../../../exception.filter';
import { UnauthorizedError } from '../../../shared/errors/unauthorized-error';
import { JwtAuthGuard } from '../../identity/infrastructure/auth.guard';
import { Track } from '../../catalog/domain/track.entity';
import { CATALOG_REPOSITORY_PORT } from '../../catalog/domain/ports/tokens';
import type { CatalogRepositoryPort } from '../domain/ports/catalog-repo.port';
import { AUDIO_STORAGE_PORT, RANGE_PARSER_PORT } from '../domain/ports/tokens';
import { PlaybackModule } from './playback.module';

/**
 * Integration spec for `PlaybackController` (PB-PR2-05, REQ-PLAY-005).
 *
 * Boots a Nest application via `Test.createTestingModule` and exercises the
 * HTTP layer end-to-end (Supertest against the real Nest pipeline). The
 * integration uses a real `FsAudioStorage` against a tmp dir fixture (so
 * the 200 / 206 byte-pipe assertions exercise the actual file-stream path),
 * a real `RangeParserAdapter` (so the 400/416 paths flow through the real
 * library), and a MOCKED `CatalogRepositoryPort` (so we don't need a
 * database to test the controller's discriminated-union → HTTP mapping).
 *
 * Auth: the real `JwtAuthGuard` is replaced with a guard override that
 * toggles between "auth" and "no-auth" tests. Using the real guard would
 * require booting identity's full DI graph (Prisma, argon, JWT secret),
 * which is exercised exhaustively in the e2e spec (PB-PR2-11). Here we
 * only want the controller contract — the 401 path is verified separately
 * via a guard-override that emulates `UnauthorizedError`.
 */
const JWT_ACCESS_SECRET = 'a'.repeat(48);
const JWT_REFRESH_SECRET = 'b'.repeat(48);

async function makeTmpAudioRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(join(tmpdir(), 'playback-controller-'));
  // Mirror the production layout: `AUDIO_STORAGE_PATH=root`, seed-style
  // filePath `/audio/sample.mp3` resolves to `<root>/audio/sample.mp3`.
  await fs.mkdir(join(root, 'audio'));
  // 4096-byte fixture so the 206 path (bytes=0-1023 → Content-Length 1024)
  // has room beyond the requested range.
  const fixtureBytes = Buffer.alloc(4096, 0);
  await fs.writeFile(join(root, 'audio', 'sample.mp3'), fixtureBytes);
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

const TRACK_ID = '00000000-0000-0000-0000-000000000001';
const SAMPLE_TRACK = Track.reconstruct({
  id: TRACK_ID,
  title: 'Sample',
  durationSeconds: 4,
  filePath: '/audio/sample.mp3',
  trackNumber: 1,
  albumId: '00000000-0000-0000-0000-000000000010',
  createdAt: new Date('2024-01-01'),
});

/** Stand-in catalog: returns the sample track (or null when configured to). */
function makeCatalogRepo(overrides: { findByIdReturn?: Track | null } = {}): CatalogRepositoryPort {
  // `??` would coalesce `null` back to SAMPLE_TRACK — use an explicit
  // undefined check so the 404 test can pass `null` and exercise the
  // missing-track branch.
  const track = overrides.findByIdReturn !== undefined ? overrides.findByIdReturn : SAMPLE_TRACK;
  return {
    findTrackById: async () => track,
    findTrackByIds: async () => (track ? [track] : []),
    findArtistById: async () => null,
    findAlbumById: async () => null,
    listArtists: async () => ({ items: [], total: 0 }),
    listAlbums: async () => ({ items: [], total: 0 }),
    search: async () => ({ artists: [], albums: [], tracks: [] }),
  };
}

interface BootOptions {
  allowAuth?: boolean; // default true — set false to exercise the 401 path
  catalog?: CatalogRepositoryPort;
}

/**
 * Test wrapper module that EXPORTS ENV_CONFIG so PlaybackModule's own
 * providers can inject it. `@Global()` is used because NestJS does NOT
 * surface root-scope `providers` to imported modules — this mirrors how
 * `PrismaModule` is declared `@Global()` so every context can resolve
 * `PrismaClient`. The same pattern needs to apply in production (AppModule
 * → ENV_CONFIG) for the design's cross-context DI to work; the e2e spec
 * (PB-PR2-11) verifies the production path.
 *
 * CATALOG_REPOSITORY_PORT is NOT overridden here — it's overridden via
 * `.overrideProvider` at compile time, which is the canonical way to
 * replace a provider bound inside another module's exports (CatalogModule
 * binds CATALOG_REPOSITORY_PORT via `useExisting`).
 *
 * The override value is pulled from a module-scoped `let` binding that
 * `bootApp` updates before each `compile()` — this lets each test supply
 * its own audio root without needing a DynamicModule.
 */
let currentAudioRoot = '';

@Global()
@Module({
  imports: [PlaybackModule],
  providers: [
    { provide: ENV_CONFIG, useFactory: () => ({ AUDIO_STORAGE_PATH: currentAudioRoot }) },
  ],
  exports: [ENV_CONFIG],
})
class TestRootModule {}

async function bootApp(audioRoot: string, opts: BootOptions = {}) {
  const allowAuth = opts.allowAuth ?? true;
  const catalog = opts.catalog ?? makeCatalogRepo();

  currentAudioRoot = audioRoot;

  // `overrideProvider` is applied at compile time across the WHOLE DI
  // graph (including bindings inside imported modules). This is the
  // canonical way to swap a provider that's bound INSIDE another module's
  // exports (e.g. CATALOG_REPOSITORY_PORT via CatalogModule.useExisting +
  // exports). Declaring the override at the test root module's providers
  // would NOT shadow CatalogModule's inner binding — overrideProvider does.
  const moduleRef = await Test.createTestingModule({ imports: [TestRootModule] })
    .overrideProvider(PrismaClient)
    // PrismaModule's factory would otherwise try to connect to the
    // placeholder DATABASE_URL. The integration spec does NOT exercise
    // Prisma — the catalog port is mocked — so a no-op stub is enough
    // to keep DI metadata happy without a real DB.
    .useValue({})
    .overrideProvider(CATALOG_REPOSITORY_PORT)
    .useValue(catalog)
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: () => (allowAuth ? true : Promise.reject(new UnauthorizedError())),
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(cookieParser());
  // Wire the GlobalExceptionFilter imperatively — APP_FILTER in the testing
  // module fails with "metatype is not a constructor" under esbuild because
  // AppLogger (the filter's optional constructor param) loses its
  // `design:paramtypes` metadata. `useGlobalFilters` bypasses DI metadata
  // entirely and matches the production filter behavior.
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return app;
}

describe('PlaybackController (integration)', () => {
  let audioRoot: string;
  let audioCleanup: () => Promise<void>;

  beforeAll(async () => {
    // PrismaModule's factory calls loadConfig() which validates env vars
    // before any provider resolves — set placeholders BEFORE the module
    // compiles. The integration spec never opens a real DB connection
    // (catalog port is mocked) but PrismaClient is still constructed.
    process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
    process.env.JWT_ACCESS_SECRET = JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = JWT_REFRESH_SECRET;
    process.env.JWT_ISSUER = 'spotify-clon';
    process.env.JWT_AUDIENCE = 'spotify-clon-users';
    // AUDIO_STORAGE_PATH placeholder — PrismaModule's loadConfig() requires
    // the field to be non-empty. The actual audio root for each test comes
    // from the per-app ENV_CONFIG override (see bootApp()).
    process.env.AUDIO_STORAGE_PATH = '/tmp/playback-controller-placeholder';

    const fixture = await makeTmpAudioRoot();
    audioRoot = fixture.root;
    audioCleanup = fixture.cleanup;
  }, 30_000);

  afterAll(async () => {
    await audioCleanup();
  });

  describe('REQ-PLAY-005 — status code paths through the HTTP layer', () => {
    it('200 — no Range header: full body, Accept-Ranges, audio/mpeg, Content-Length = total', async () => {
      const app = await bootApp(audioRoot);
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/tracks/${TRACK_ID}/stream`)
          .set('Authorization', 'Bearer test');

        expect(res.status).toBe(200);
        expect(res.headers['accept-ranges']).toBe('bytes');
        expect(res.headers['content-type']).toBe('audio/mpeg');
        expect(Number(res.headers['content-length'])).toBe(4096);
        expect(res.body.length).toBe(4096); // body equals the fixture bytes
      } finally {
        await app.close();
      }
    });

    it('206 — satisfiable Range: Content-Range + Content-Length = end - start + 1', async () => {
      const app = await bootApp(audioRoot);
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/tracks/${TRACK_ID}/stream`)
          .set('Authorization', 'Bearer test')
          .set('Range', 'bytes=0-1023');

        expect(res.status).toBe(206);
        expect(res.headers['accept-ranges']).toBe('bytes');
        expect(res.headers['content-type']).toBe('audio/mpeg');
        expect(res.headers['content-range']).toBe('bytes 0-1023/4096');
        expect(Number(res.headers['content-length'])).toBe(1024);
        expect(res.body.length).toBe(1024);
      } finally {
        await app.close();
      }
    });

    it('416 — unsatisfiable Range: Content-Range: bytes * slash total, empty body', async () => {
      const app = await bootApp(audioRoot);
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/tracks/${TRACK_ID}/stream`)
          .set('Authorization', 'Bearer test')
          .set('Range', 'bytes=999999-');

        expect(res.status).toBe(416);
        expect(res.headers['content-range']).toBe('bytes */4096');
        // 416 body is empty by design (Q5).
        expect(res.body.length).toBe(0);
      } finally {
        await app.close();
      }
    });

    it('400 invalid — Range: bytes=abc: ValidationError envelope', async () => {
      const app = await bootApp(audioRoot);
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/tracks/${TRACK_ID}/stream`)
          .set('Authorization', 'Bearer test')
          .set('Range', 'bytes=abc');

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      } finally {
        await app.close();
      }
    });

    it('400 multi-range — Range: bytes=0-10,20-30: ValidationError envelope', async () => {
      const app = await bootApp(audioRoot);
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/tracks/${TRACK_ID}/stream`)
          .set('Authorization', 'Bearer test')
          .set('Range', 'bytes=0-10,20-30');

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      } finally {
        await app.close();
      }
    });

    it('404 — missing track: NotFoundError envelope', async () => {
      const app = await bootApp(audioRoot, {
        catalog: makeCatalogRepo({ findByIdReturn: null }),
      });
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/tracks/${TRACK_ID}/stream`)
          .set('Authorization', 'Bearer test');

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      } finally {
        await app.close();
      }
    });

    it('401 — no / invalid JWT: UnauthorizedError envelope', async () => {
      const app = await bootApp(audioRoot, { allowAuth: false });
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/tracks/${TRACK_ID}/stream`);

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
      } finally {
        await app.close();
      }
    });
  });

  describe('REQ-PLAY-005 — filePath leak guard', () => {
    // The stored filePath (/audio/sample.mp3) is an internal storage detail
    // and MUST NEVER appear in any response body, header, or status line —
    // across ALL status code paths.
    const FILE_PATH = '/audio/sample.mp3';

    it('200 path does not leak filePath in body or headers', async () => {
      const app = await bootApp(audioRoot);
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/tracks/${TRACK_ID}/stream`)
          .set('Authorization', 'Bearer test');

        const bodyStr = JSON.stringify(res.body);
        const headerStr = JSON.stringify(res.headers);
        expect(bodyStr).not.toContain(FILE_PATH);
        expect(headerStr).not.toContain(FILE_PATH);
      } finally {
        await app.close();
      }
    });

    it('416 path does not leak filePath in body or headers', async () => {
      const app = await bootApp(audioRoot);
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/tracks/${TRACK_ID}/stream`)
          .set('Authorization', 'Bearer test')
          .set('Range', 'bytes=999999-');

        const bodyStr = JSON.stringify(res.body);
        const headerStr = JSON.stringify(res.headers);
        expect(bodyStr).not.toContain(FILE_PATH);
        expect(headerStr).not.toContain(FILE_PATH);
      } finally {
        await app.close();
      }
    });

    it('400 path does not leak filePath in body or headers', async () => {
      const app = await bootApp(audioRoot);
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/tracks/${TRACK_ID}/stream`)
          .set('Authorization', 'Bearer test')
          .set('Range', 'bytes=abc');

        const bodyStr = JSON.stringify(res.body);
        const headerStr = JSON.stringify(res.headers);
        expect(bodyStr).not.toContain(FILE_PATH);
        expect(headerStr).not.toContain(FILE_PATH);
      } finally {
        await app.close();
      }
    });

    it('404 path does not leak filePath in body or headers', async () => {
      const app = await bootApp(audioRoot, {
        catalog: makeCatalogRepo({ findByIdReturn: null }),
      });
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/tracks/${TRACK_ID}/stream`)
          .set('Authorization', 'Bearer test');

        const bodyStr = JSON.stringify(res.body);
        const headerStr = JSON.stringify(res.headers);
        expect(bodyStr).not.toContain(FILE_PATH);
        expect(headerStr).not.toContain(FILE_PATH);
      } finally {
        await app.close();
      }
    });
  });
});

// Mark unused imports as referenced for tsc — the integration does not
// exercise the real signer/storage/parser directly, but importing the
// tokens guarantees the type relationships used by PlaybackModule compile.
void AUDIO_STORAGE_PORT;
void RANGE_PARSER_PORT;
