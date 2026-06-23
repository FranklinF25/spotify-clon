import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CatalogE2eContext,
  registerUser,
  startCatalogE2E,
} from '../helpers/catalog-e2e-app';

/**
 * `GET /api/v1/tracks/:id` e2e (catalog spec R4: "Track Detail Endpoint").
 * Asserts the R4 invariant: track primitives NEVER include `filePath`
 * (internal storage detail; the future `playback` context reads it via the
 * port, not the HTTP projection). Also covers the R4 negative case — there
 * is no `GET /api/v1/tracks` list endpoint (tracks are reached via album
 * detail or `/search`).
 */
describe('Catalog tracks endpoint', () => {
  let ctx: CatalogE2eContext;
  let token: string;
  let seededTrackId: string;

  beforeAll(async () => {
    ctx = await startCatalogE2E();
    token = await registerUser(ctx.app, 'catalog-tracks@example.com');
    const first = await ctx.prisma.track.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    seededTrackId = first!.id;
  }, 90_000);
  afterAll(async () => {
    await ctx.cleanup();
  });

  it('returns 200 with the track projection and NO filePath leak', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/v1/tracks/${seededTrackId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Track primitive key set: id, title, durationSeconds, trackNumber, albumId.
    // `filePath` is omitted from `Track.toPrimitive()` (R4 guard).
    expect(Object.keys(res.body).sort()).toEqual(
      ['albumId', 'durationSeconds', 'id', 'title', 'trackNumber'].sort(),
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        id: seededTrackId,
        title: expect.any(String),
        durationSeconds: expect.any(Number),
        trackNumber: expect.any(Number),
        albumId: expect.any(String),
      }),
    );
    expect('filePath' in res.body).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/filePath/);
  });

  it('returns 404 NOT_FOUND for a non-existent track id', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/tracks/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does NOT expose a list endpoint (GET /api/v1/tracks → 404 NOT_FOUND)', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/tracks')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });
});
