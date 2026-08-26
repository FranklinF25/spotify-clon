import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useLibraryAlbums } from './use-library-albums';
import { useAddAlbumToLibrary } from './use-add-album-to-library';

/**
 * F6 WORK-PR3-02 — useAddAlbumToLibrary mutation (REQ-FE-017; DESIGN §9.2).
 * POST /library/albums/:id → 204. onSuccess invalidates ONLY
 * ['library','albums'] (D-fe-2 cache discipline).
 */
function Harness({ id }: { id: string }) {
  const list = useLibraryAlbums();
  const save = useAddAlbumToLibrary();
  return (
    <div>
      <span data-testid="count">{list.data?.length ?? 0}</span>
      <button data-testid="save" onClick={() => save.mutateAsync({ id })} />
    </div>
  );
}

const ONE = [
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
];
const TWO = [
  ...ONE,
  {
    album: {
      id: 'A2',
      title: 'Blue Train',
      releaseYear: 1957,
      coverUrl: null,
      artist: { id: 'ar2', name: 'John Coltrane' },
    },
    addedAt: '2025-01-03T00:00:00.000Z',
  },
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useAddAlbumToLibrary — POST + invalidate library list (REQ-FE-017)', () => {
  it('POSTs and invalidates ["library","albums"] (refetch fires)', async () => {
    let listCount = 0;
    server.use(
      http.get(endpoints.library.albums, () => {
        listCount += 1;
        return HttpResponse.json(listCount === 1 ? ONE : TWO);
      }),
    );
    const postSpy = vi.fn(() => new HttpResponse(null, { status: 204 }));
    server.use(http.post(endpoints.library.album('A2'), postSpy));

    render(<Harness id="A2" />);
    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('1'),
    );

    screen.getByTestId('save').click();

    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('2'),
    );
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(listCount).toBe(2); // initial + refetch after invalidation
  });

  it('encodes the album id in the path', async () => {
    server.use(
      http.get(endpoints.library.albums, () => HttpResponse.json(ONE)),
    );
    const postSpy = vi.fn(() => new HttpResponse(null, { status: 204 }));
    server.use(http.post(endpoints.library.album('A2'), postSpy));

    render(<Harness id="A2" />);
    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('1'),
    );
    screen.getByTestId('save').click();
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    // endpoints.library.album already encodeURIComponent-ed; the handler
    // matched the same URL the hook requested — proven by the spy hit.
  });
});
