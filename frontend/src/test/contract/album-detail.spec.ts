import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { server } from '@/test/msw/server';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import type { AlbumDetail, PaginatedResult, AlbumSummary } from '@/types/api';
import { paginationSchema } from '@/lib/zod-schemas/pagination';
import {
  albumDetailAssertionSchema,
  albumSummaryAssertionSchema,
  paginatedAssertionSchema,
} from './schemas';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useAuthStore.setState({ accessToken: null });
});
afterAll(() => server.close());

describe('contract: albums endpoints', () => {
  it('GET /albums parses the pagination envelope + each AlbumSummary', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    const body = await httpClient.get<PaginatedResult<AlbumSummary>>(
      endpoints.albums.list(1, 20),
    );
    // The query-string provenance goes through the form-validator mirror too.
    expect(
      paginationSchema.safeParse({ page: body.page, pageSize: body.pageSize })
        .success,
    ).toBe(true);
    const result = paginatedAssertionSchema(albumSummaryAssertionSchema).safeParse(
      body,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items.length).toBeGreaterThan(0);
      expect(result.data.total).toBe(result.data.items.length);
    }
  });

  it('GET /albums/:id embeds a non-empty tracks[] + artist (AlbumDetail)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    const album = await httpClient.get<AlbumDetail>(
      endpoints.albums.detail('L1'),
    );
    const result = albumDetailAssertionSchema.safeParse(album);
    expect(result.success).toBe(true);
    if (result.success) {
      // The two embedding guarantees the spec locks.
      expect(result.data.tracks.length).toBeGreaterThan(0);
      expect(result.data.artist.id).toBeDefined();
      // The internal storage path field MUST NOT leak (REQ-FE-004).
      expect('filePath' in result.data).toBe(false);
    }
  });
});
