import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CatalogE2eContext,
  registerUser,
  startCatalogE2E,
} from '../helpers/catalog-e2e-app';

/**
 * `GET /api/v1/artists` + `GET /api/v1/artists/:id` e2e (catalog spec: "Artist
 * Read Endpoints" — Requirements R1 + R2).
 *
 * The canonical seed (`runSeed` from `catalog-e2e-app.ts`) populates 5 artists
 * with 2 albums each, so the assertions below reference that exact fixture
 * shape. A dedicated pagination spec (CAT-PR2b2-05) covers the INVALID_PAGINATION
 * matrix exhaustively; this file focuses on the artist read scenarios.
 */
describe('Catalog artists endpoints', () => {
  let ctx: CatalogE2eContext;
  let token: string;
  let seededArtistId: string;

  beforeAll(async () => {
    ctx = await startCatalogE2E();
    token = await registerUser(ctx.app, 'catalog-artists@example.com');
    const first = await ctx.prisma.artist.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    seededArtistId = first!.id;
  }, 90_000);
  afterAll(async () => {
    await ctx.cleanup();
  });

  it('lists artists with default pagination (page=1, pageSize=20, total=5)', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/artists')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: expect.arrayContaining([
        expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
      ]),
      page: 1,
      pageSize: 20,
      total: 5,
    });
    expect(res.body.items).toHaveLength(5);
    // ArtistSummary carries only id + name — no internal fields leak.
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['id', 'name']);
  });

  it('lists artists with custom pagination (?page=1&pageSize=2)', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/artists?page=1&pageSize=2')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: expect.any(Array),
      page: 1,
      pageSize: 2,
      total: 5,
    });
    expect(res.body.items).toHaveLength(2);
  });

  it('returns 200 with empty items on an out-of-range page (NOT 404)', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/artists?page=999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [],
      page: 999,
      pageSize: 20,
      total: 5,
    });
  });

  it('returns 400 INVALID_PAGINATION when pageSize exceeds the max', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/artists?pageSize=101')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'INVALID_PAGINATION' });
  });

  it('returns artist detail with the raw projection (id, name) + embedded albums', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/v1/artists/${seededArtistId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        id: seededArtistId,
        name: expect.any(String),
        bio: null,
        imageUrl: null,
        albums: expect.any(Array),
      }),
    );
    // The seeded artist has exactly 2 albums.
    expect(res.body.albums).toHaveLength(2);
    expect(Object.keys(res.body.albums[0]).sort()).toEqual(
      ['coverUrl', 'id', 'releaseYear', 'artist', 'title'].sort(),
    );
  });

  it('returns 404 NOT_FOUND for a non-existent artist id', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/artists/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });
});
