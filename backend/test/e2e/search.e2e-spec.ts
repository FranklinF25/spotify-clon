import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CatalogE2eContext,
  registerUser,
  startCatalogE2E,
} from '../helpers/catalog-e2e-app';

/**
 * `GET /api/v1/search` e2e (catalog spec R6: "Full-Text Search Endpoint").
 *
 * Covers the three spec-locked scenarios against the canonical seed fixture
 * (5 artists × 2 albums each × 4 tracks per album = 10 albums + 40 tracks):
 *
 *   1. "Query matches entities across types" — `?q=album` returns 200 with
 *      non-empty `artists`/`albums`/`tracks` arrays (every album title
 *      contains the token "Album", every track title contains "Track", and
 *      every artist name contains "Artist" — so any of those tokens
 *      cross-matches).
 *   2. "Empty query is rejected" — both `?q=` (empty after trim) and a
 *      missing `q` parameter surface as 400 with the spec-pinned
 *      `INVALID_QUERY` token (R3-W-3 lesson applied to R6).
 *   3. "No matches returns 200 with empty result sets per type" —
 *      `?q=zzznomatch` returns 200 with `{ artists: [], albums: [], tracks: [] }`.
 *
 * The auth matrix (`/search` 401 without Bearer) lives in
 * `catalog-auth.e2e-spec.ts` (CAT-PR2b2-06 extended in CAT-PR3c-04).
 */
describe('Catalog search endpoint (R6 full-text search)', () => {
  let ctx: CatalogE2eContext;
  let token: string;

  beforeAll(async () => {
    ctx = await startCatalogE2E();
    token = await registerUser(ctx.app, 'catalog-search@example.com');
  }, 90_000);
  afterAll(async () => {
    await ctx.cleanup();
  });

  describe('Empty query is rejected (400 INVALID_QUERY)', () => {
    // Each of these surfaces as 400 with the spec-pinned `INVALID_QUERY`
    // token — the controller's `validateSearch` wrapper (Zod `min(1)` after
    // trim) catches empty, whitespace-only, and missing `q` uniformly.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['?q= (empty after trim)', 'q='],
      ['missing q parameter', ''],
      ['?q=%20%20 (whitespace-only)', 'q=%20%20'],
    ];
    it.each(cases)('rejects %s with INVALID_QUERY', async (_label, query) => {
      const url = query ? `/api/v1/search?${query}` : '/api/v1/search';
      const res = await request(ctx.app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: 'INVALID_QUERY' });
    });
  });

  describe('Query matches entities across types (200 grouped result)', () => {
    it('returns 200 with non-empty arrays for a token that matches every row', async () => {
      // The canonical seed: artist names all contain "Artist", album titles
      // all contain "Album", track titles all contain "Track". A token like
      // "one" matches "Artist One", "Album One", "Track One" across the
      // fixture set (every artist has at least one such entity).
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/search?q=one')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.artists)).toBe(true);
      expect(Array.isArray(res.body.albums)).toBe(true);
      expect(Array.isArray(res.body.tracks)).toBe(true);
      // "one" appears in every "Artist One" / "Album One" / "Track One"
      // (5 artists × 1 "One" album each + 5 "One" tracks per "One" album =
      // 5 each). Assert NON-EMPTY — the spec says "includes matching
      // artists, matching albums, and matching tracks".
      expect(res.body.artists.length).toBeGreaterThan(0);
      expect(res.body.albums.length).toBeGreaterThan(0);
      expect(res.body.tracks.length).toBeGreaterThan(0);
      // Every returned artist name MUST contain "One" (tsvector stem on the
      // `simple` config lowercases but does not stem — word match).
      for (const artist of res.body.artists) {
        expect(artist.name.toLowerCase()).toContain('one');
      }
      for (const album of res.body.albums) {
        expect(album.title.toLowerCase()).toContain('one');
        // AlbumSummary carries the embedded artist summary.
        expect(album.artist).toEqual(
          expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
        );
      }
      for (const track of res.body.tracks) {
        expect(track.title.toLowerCase()).toContain('one');
        // TrackSummary shape: NO filePath (R4/R6 guard).
        expect(Object.keys(track).sort()).toEqual(
          ['albumId', 'durationSeconds', 'id', 'title'].sort(),
        );
      }
    });

    it('respects the type filter (only the matching group is populated)', async () => {
      // `?q=one&type=artist` MUST populate artists and leave albums + tracks
      // as empty arrays (port contract: when `type` is set, the other two
      // groups come back empty).
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/search?q=one&type=artist')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.artists.length).toBeGreaterThan(0);
      expect(res.body.albums).toEqual([]);
      expect(res.body.tracks).toEqual([]);
    });
  });

  describe('No matches returns 200 with empty result sets per type', () => {
    it('returns 200 with { artists: [], albums: [], tracks: [] } for ?q=zzznomatch', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/search?q=zzznomatch')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ artists: [], albums: [], tracks: [] });
    });
  });
});
