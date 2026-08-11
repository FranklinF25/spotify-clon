import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistSummary } from '@/types/api';
import { usePlaylists } from './use-playlists';
import { useDeletePlaylist } from './use-delete-playlist';

/**
 * FE-PR3-02 — useDeletePlaylist mutation.
 * DELETE /playlists/:id → 204 (FK CASCADE clears tracks).
 * onSuccess invalidates ['playlists','list'] (the card disappears).
 */
function Harness({ id }: { id: string }) {
  const list = usePlaylists();
  const remove = useDeletePlaylist();
  return (
    <div>
      <span data-testid="count">{list.data?.length ?? 0}</span>
      <button
        data-testid="delete"
        onClick={() => remove.mutateAsync({ id })}
      />
    </div>
  );
}

const TWO: PlaylistSummary[] = [
  { id: 'P1', title: 'A', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'P2', title: 'B', createdAt: '2025-01-02T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z' },
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useDeletePlaylist — DELETE + invalidate list (REQ-FE-014)', () => {
  it('DELETEs and invalidates ["playlists","list"] (refetch fires)', async () => {
    let listCount = 0;
    server.use(
      http.get(endpoints.playlists.list, () => {
        listCount += 1;
        return HttpResponse.json(listCount === 1 ? TWO : [
          { id: 'P2', title: 'B', createdAt: '2025-01-02T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z' },
        ]);
      }),
    );
    const deleteSpy = vi.fn(() => new HttpResponse(null, { status: 204 }));
    server.use(http.delete(endpoints.playlists.remove('P1'), deleteSpy));

    render(<Harness id="P1" />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));

    screen.getByTestId('delete').click();

    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('1'),
    );
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(listCount).toBe(2); // initial + refetch after invalidation
  });
});
