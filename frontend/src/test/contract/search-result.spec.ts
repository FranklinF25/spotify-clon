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
import type { SearchResult } from '@/types/api';
import { searchResultAssertionSchema } from './schemas';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useAuthStore.setState({ accessToken: null });
});
afterAll(() => server.close());

describe('contract: search endpoint', () => {
  it('GET /search?q= returns three grouped arrays (artists, albums, tracks)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    const result = await httpClient.get<SearchResult>(
      endpoints.search('foo'),
    );
    const parsed = searchResultAssertionSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // All three groups present (REQ-FE-010 three grouped sections).
      expect(Array.isArray(parsed.data.artists)).toBe(true);
      expect(Array.isArray(parsed.data.albums)).toBe(true);
      expect(Array.isArray(parsed.data.tracks)).toBe(true);
      // TrackSummary carries albumId (the read-models asymmetry — DESIGN §4.1).
      if (parsed.data.tracks.length > 0) {
        expect(parsed.data.tracks[0]).toHaveProperty('albumId');
      }
    }
  });
});
