import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { SavedAlbum } from '@/types/api';
import { useLibraryAlbums } from './use-library-albums';

/**
 * F6 WORK-PR3-02 — useLibraryAlbums query (REQ-FE-016; DESIGN §9.2).
 * queryKey ['library','albums']; GET /library/albums → SavedAlbum[]
 * (bare array, most-recent-first server-side).
 */
function Harness() {
  const { data, isLoading } = useLibraryAlbums();
  if (isLoading) return <div>Loading</div>;
  return <span data-testid="count">{data?.length ?? 0}</span>;
}

const SAVED: SavedAlbum[] = [
  {
    album: {
      id: 'A1',
      title: 'Kind of Blue',
      releaseYear: 1959,
      coverUrl: null,
      artist: { id: 'ar1', name: 'Miles Davis' },
    },
    addedAt: '2025-01-02T00:00:00.000Z',
  },
  {
    album: {
      id: 'A2',
      title: 'Blue Train',
      releaseYear: 1957,
      coverUrl: null,
      artist: { id: 'ar2', name: 'John Coltrane' },
    },
    addedAt: '2025-01-01T00:00:00.000Z',
  },
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useLibraryAlbums — saved-albums list (REQ-FE-016)', () => {
  it('fetches GET /library/albums and returns SavedAlbum[]', async () => {
    server.use(
      http.get(endpoints.library.albums, () => HttpResponse.json(SAVED)),
    );
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('2'),
    );
  });

  it('handles an empty library honestly', async () => {
    server.use(
      http.get(endpoints.library.albums, () => HttpResponse.json([])),
    );
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('0'),
    );
  });
});
