import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CatalogE2eContext,
  registerUser,
  startCatalogE2E,
} from '../helpers/catalog-e2e-app';

/**
 * `GET /api/v1/albums` + `GET /api/v1/albums/:id` e2e (catalog spec R3:
 * "Album Read Endpoints"). The seed fixture is 5 artists × 2 albums each
 * (10 albums total), with 4 tracks per album. Pagination bounds + the
 * INVALID_PAGINATION matrix are covered exhaustively in
 * `pagination.e2e-spec.ts`; this file focuses on the album read scenarios.
 */
describe('Catalog albums endpoints', () => {
  let ctx: CatalogE2eContext;
  let token: string;
  let seededAlbumId: string;

  beforeAll(async () => {
    ctx = await startCatalogE2E();
    token = await registerUser(ctx.app, 'catalog-albums@example.com');
    const first = await ctx.prisma.album.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    seededAlbumId = first!.id;
  }, 90_000);
  afterAll(async () => {
    await ctx.cleanup();
  });

  it('lists albums with default pagination (page=1, pageSize=20, total=10)', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/albums')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: expect.any(Array),
      page: 1,
      pageSize: 20,
      total: 10,
    });
    expect(res.body.items).toHaveLength(10);
    // AlbumSummary = { id, title, releaseYear, coverUrl, artist: { id, name } }.
    expect(Object.keys(res.body.items[0]).sort()).toEqual(
      ['artist', 'coverUrl', 'id', 'releaseYear', 'title'].sort(),
    );
    expect(Object.keys(res.body.items[0].artist).sort()).toEqual(['id', 'name']);
  });

  it('lists albums with custom pagination (?page=1&pageSize=3)', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/albums?page=1&pageSize=3')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: expect.any(Array), page: 1, pageSize: 3, total: 10 });
    expect(res.body.items).toHaveLength(3);
  });

  it('returns album detail with embedded artist summary and non-empty tracks[]', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/v1/albums/${seededAlbumId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Controller merges album.toPrimitive() (5 keys) with { artist, tracks }.
    expect(res.body).toEqual(
      expect.objectContaining({
        id: seededAlbumId,
        title: expect.any(String),
        releaseYear: null,
        coverUrl: null,
        artistId: expect.any(String),
        artist: { id: expect.any(String), name: expect.any(String) },
        tracks: expect.any(Array),
      }),
    );
    // The seeded album has exactly 4 tracks.
    expect(res.body.tracks).toHaveLength(4);
    // R4 guard: track primitives NEVER include `filePath`.
    expect('filePath' in res.body.tracks[0]).toBe(false);
    expect(Object.keys(res.body.tracks[0]).sort()).toEqual(
      ['albumId', 'durationSeconds', 'id', 'title', 'trackNumber'].sort(),
    );
  });

  it('returns 404 NOT_FOUND for a non-existent album id', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/albums/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });
});
