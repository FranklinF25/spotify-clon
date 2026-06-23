import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CatalogE2eContext,
  registerUser,
  startCatalogE2E,
} from '../helpers/catalog-e2e-app';

/**
 * Offset pagination envelope e2e (catalog spec R5). Authoritative matrix
 * across BOTH list endpoints (`/artists` + `/albums`) — the artists spec
 * narrates `/artists` flow; this file is the definitive R5 pinning.
 *
 * Per spec: out-of-range pages MUST return 200 with empty `items` + accurate
 * `total` (NOT 404); non-positive page/pageSize or pageSize > MAX_PAGE_SIZE
 * (100) MUST return 400 INVALID_PAGINATION.
 */
describe('Catalog offset pagination envelope (R5)', () => {
  let ctx: CatalogE2eContext;
  let token: string;

  beforeAll(async () => {
    ctx = await startCatalogE2E();
    token = await registerUser(ctx.app, 'catalog-pagination@example.com');
  }, 90_000);
  afterAll(async () => {
    await ctx.cleanup();
  });

  // Seed totals: 5 artists, 10 albums (5 × 2).
  describe.each([
    ['/api/v1/artists', 5],
    ['/api/v1/albums', 10],
  ] as const)('default + out-of-range on %s', (endpoint, total) => {
    it('applies defaults page=1, pageSize=20 with accurate total', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get(endpoint)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: expect.any(Array),
        page: 1,
        pageSize: 20,
        total,
      });
      expect(res.body.items).toHaveLength(total);
    });

    it('returns 200 with empty items + accurate total on out-of-range page (NOT 404)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get(`${endpoint}?page=999`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], page: 999, pageSize: 20, total });
    });
  });

  // R5 negative cases: non-positive or over-max pagination → 400 INVALID_PAGINATION.
  // Cross-checked on both endpoints so the spec-pinned error token is
  // verifiably uniform across the catalog surface.
  describe.each([
    ['page=0', 'page=0'],
    ['pageSize=0', 'pageSize=0'],
    ['pageSize=101 (over MAX_PAGE_SIZE)', 'pageSize=101'],
  ])('INVALID_PAGINATION on %s', (label, query) => {
    it.each(['/api/v1/artists', '/api/v1/albums'] as const)(
      `returns 400 INVALID_PAGINATION on %s (${label})`,
      async (endpoint) => {
        const res = await request(ctx.app.getHttpServer())
          .get(`${endpoint}?${query}`)
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatchObject({ code: 'INVALID_PAGINATION' });
      },
    );
  });
});
