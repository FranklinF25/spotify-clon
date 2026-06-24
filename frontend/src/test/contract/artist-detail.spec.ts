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
import type { ArtistDetail } from '@/types/api';
import { artistDetailAssertionSchema } from './schemas';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useAuthStore.setState({ accessToken: null });
});
afterAll(() => server.close());

describe('contract: artist detail endpoint', () => {
  it('GET /artists/:id embeds an albums[] array (ArtistDetail)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    const artist = await httpClient.get<ArtistDetail>(
      endpoints.artists.detail('A1'),
    );
    const result = artistDetailAssertionSchema.safeParse(artist);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.albums.length).toBeGreaterThan(0);
      // bio + imageUrl are nullable but must be present keys (never undefined).
      expect(result.data).toHaveProperty('bio');
      expect(result.data).toHaveProperty('imageUrl');
      expect('filePath' in result.data).toBe(false);
    }
  });
});
