import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CatalogE2eContext,
  registerUser,
  startCatalogE2E,
} from '../helpers/catalog-e2e-app';

/**
 * Auth matrix e2e (catalog spec R1: "Catalog Endpoint Authentication").
 *
 * Exhaustive cross-product of every catalog read endpoint × every
 * invalid-auth state. The class-level `@UseGuards(JwtAuthGuard)` on
 * `CatalogController` enforces JWT uniformly, so each cell MUST collapse to
 * the same 401 UNAUTHORIZED envelope. The `/search` route was added in
 * PR-3c (CAT-PR3c-04) and is now part of the matrix.
 *
 * Endpoint ids (`/artists/:id`, `/albums/:id`, `/tracks/:id`) are seeded UUIDs
 * so the guard is the only thing being exercised — no 404 / 500 noise from a
 * missing resource. `/search` does not reference a resource id, so it carries
 * no path parameter.
 */
describe('Catalog auth matrix — JWT required on every endpoint (R1)', () => {
  let ctx: CatalogE2eContext;
  let token: string;
  let seededArtistId: string;
  let seededAlbumId: string;
  let seededTrackId: string;

  beforeAll(async () => {
    ctx = await startCatalogE2E();
    token = await registerUser(ctx.app, 'catalog-auth@example.com');
    const [artist, album, track] = await Promise.all([
      ctx.prisma.artist.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }),
      ctx.prisma.album.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }),
      ctx.prisma.track.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }),
    ]);
    seededArtistId = artist!.id;
    seededAlbumId = album!.id;
    seededTrackId = track!.id;
  }, 90_000);
  afterAll(async () => {
    await ctx.cleanup();
  });

  // Every catalog read endpoint. Each MUST reject unauthenticated requests.
  // `/search` added in CAT-PR3c-04 — it carries `?q=foo` so the guard runs
  // before any query parsing (a 401 MUST NOT depend on the validity of `q`).
  const endpoints: ReadonlyArray<readonly [string, string]> = [
    ['GET /api/v1/artists', '/api/v1/artists'],
    ['GET /api/v1/artists/:id', `/api/v1/artists/${seededArtistId}`],
    ['GET /api/v1/albums', '/api/v1/albums'],
    ['GET /api/v1/albums/:id', `/api/v1/albums/${seededAlbumId}`],
    ['GET /api/v1/tracks/:id', `/api/v1/tracks/${seededTrackId}`],
    ['GET /api/v1/search', '/api/v1/search?q=foo'],
  ];

  describe('missing Authorization header → 401 UNAUTHORIZED', () => {
    it.each(endpoints)('%s', async (_label, url) => {
      const res = await request(ctx.app.getHttpServer()).get(url);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  describe('malformed Bearer token → 401 UNAUTHORIZED', () => {
    it.each(endpoints)('%s', async (_label, url) => {
      const res = await request(ctx.app.getHttpServer())
        .get(url)
        .set('Authorization', 'Bearer not-a-jwt');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  it('sanity: a valid Bearer token still reaches the handler (200)', async () => {
    // Guards against a false-positive matrix (e.g. if JwtAuthGuard rejected
    // everything including valid tokens, every cell above would still pass).
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/artists')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
