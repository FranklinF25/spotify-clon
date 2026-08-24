import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useLibraryAlbums } from './use-library-albums';
import { useRemoveAlbumFromLibrary } from './use-remove-album-from-library';

/**
 * F6 WORK-PR3-02 — useRemoveAlbumFromLibrary mutation (REQ-FE-017; DESIGN
 * §9.2). DELETE /library/albums/:id → 204 (idempotent server-side).
 * onSuccess invalidates ONLY ['library','albums'].
 */
function Harness({ id }: { id: string }) {
  const list = useLibraryAlbums();
  const remove = useRemoveAlbumFromLibrary();
  return (
    <div>
      <span data-testid="count">{list.data?.length ?? 0}</span>
      <button data-testid="remove" onClick={() => remove.mutateAsync({ id })} />
    </div>
  );
}

const TWO = [
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

describe('useRemoveAlbumFromLibrary — DELETE + invalidate library list (REQ-FE-017)', () => {
  it('DELETEs and invalidates ["library","albums"] (refetch fires)', async () => {
    let listCount = 0;
    server.use(
      http.get(endpoints.library.albums, () => {
        listCount += 1;
        return HttpResponse.json(listCount === 1 ? TWO : TWO.slice(0, 1));
      }),
    );
    const deleteSpy = vi.fn(() => new HttpResponse(null, { status: 204 }));
    server.use(http.delete(endpoints.library.album('A2'), deleteSpy));

    render(<Harness id="A2" />);
    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('2'),
    );

    screen.getByTestId('remove').click();

    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('1'),
    );
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(listCount).toBe(2); // initial + refetch after invalidation
  });

  it('treats an idempotent 204 on an unsaved album as success (no refetch error)', async () => {
    let listCount = 0;
    server.use(
      http.get(endpoints.library.albums, () => {
        listCount += 1;
        return HttpResponse.json(TWO);
      }),
    );
    const deleteSpy = vi.fn(() => new HttpResponse(null, { status: 204 }));
    server.use(http.delete(endpoints.library.album('A9'), deleteSpy));

    render(<Harness id="A9" />);
    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('2'),
    );
    screen.getByTestId('remove').click();
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
    // Invalidation refetches; list unchanged (2 items) — no error thrown.
    await waitFor(() => expect(listCount).toBe(2));
    expect(screen.getByTestId('count').textContent).toBe('2');
  });
});
