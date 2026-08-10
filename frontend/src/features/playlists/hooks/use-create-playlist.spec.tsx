import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistPrimitive, PlaylistSummary } from '@/types/api';
import { usePlaylists } from './use-playlists';
import { useCreatePlaylist } from './use-create-playlist';

/**
 * FE-PR3-02 — useCreatePlaylist mutation.
 * POST /playlists { title } → 201 PlaylistPrimitive.
 * onSuccess invalidates ['playlists','list'] so the new card appears.
 */
const CREATED: PlaylistPrimitive = {
  id: 'P3',
  userId: 'U1',
  title: 'New mix',
  createdAt: '2025-01-03T00:00:00.000Z',
  updatedAt: '2025-01-03T00:00:00.000Z',
};

const EMPTY: PlaylistSummary[] = [];

function Harness() {
  const list = usePlaylists();
  const create = useCreatePlaylist();
  return (
    <div>
      <span data-testid="count">{list.data?.length ?? 0}</span>
      <button
        data-testid="create"
        onClick={() => create.mutateAsync({ title: 'New mix' })}
      />
    </div>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useCreatePlaylist — POST + invalidate list (REQ-FE-014)', () => {
  it('POSTs and invalidates ["playlists","list"] (refetch fires)', async () => {
    let listReqCount = 0;
    server.use(
      http.get(endpoints.playlists.list, () => {
        listReqCount += 1;
        return HttpResponse.json(listReqCount === 1 ? EMPTY : [
          {
            id: 'P3',
            title: 'New mix',
            createdAt: '2025-01-03T00:00:00.000Z',
            updatedAt: '2025-01-03T00:00:00.000Z',
          },
        ]);
      }),
    );
    const postSpy = vi.fn(() => HttpResponse.json(CREATED, { status: 201 }));
    server.use(http.post(endpoints.playlists.create, postSpy));

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));

    screen.getByTestId('create').click();

    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('1'),
    );
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(listReqCount).toBe(2); // initial + refetch after invalidation
  });
});
