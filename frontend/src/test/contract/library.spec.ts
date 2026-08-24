import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import type { SavedAlbum } from '@/types/api';
import {
  savedAlbumListAssertionSchema,
} from '@/lib/zod-schemas/library';

/**
 * F6 WORK-PR3-01 — self-hosted MSW contract spec for the library list
 * (REQ-FE-016; D-fe-2: per-spec server.use overrides — handlers.ts is
 * frozen at the 12 slice-A endpoints). Asserts the wire shape parses the
 * zod mirror; a drift fixture MUST be rejected.
 */

const A1 = {
  id: 'A1',
  title: 'Kind of Blue',
  releaseYear: 1959,
  coverUrl: null,
  artist: { id: 'ar1', name: 'Miles Davis' },
};
const A2 = {
  id: 'A2',
  title: 'Blue Train',
  releaseYear: 1957,
  coverUrl: null,
  artist: { id: 'ar2', name: 'John Coltrane' },
};
const SAVED: SavedAlbum[] = [
  { album: A1, addedAt: '2025-01-02T00:00:00.000Z' },
  { album: A2, addedAt: '2025-01-01T00:00:00.000Z' },
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useAuthStore.setState({ accessToken: null });
});
afterAll(() => server.close());

describe('contract: library endpoints', () => {
  it('GET /library/albums returns SavedAlbum[] that parses the zod mirror', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    server.use(
      http.get(endpoints.library.albums, () => HttpResponse.json(SAVED)),
    );
    const body = await httpClient.get<SavedAlbum[]>(endpoints.library.albums);
    const result = savedAlbumListAssertionSchema.safeParse(body);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.map((s) => s.album.id)).toEqual(['A1', 'A2']);
      expect(result.data[0]!.addedAt).toBe('2025-01-02T00:00:00.000Z');
    }
  });

  it('rejects a drift response (entry missing addedAt) — REQ-FE-005 discipline', () => {
    const drift = [{ album: A1 }];
    expect(savedAlbumListAssertionSchema.safeParse(drift).success).toBe(false);
  });
});
