import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistPrimitive } from '@/types/api';
import { usePlaylist } from './use-playlist';
import { usePlaylists } from './use-playlists';
import { useRenamePlaylist } from './use-rename-playlist';

/**
 * FE-PR3-02 — useRenamePlaylist mutation.
 * PATCH /playlists/:id { title } → 200 PlaylistPrimitive.
 * onSuccess invalidates BOTH ['playlists','detail',id] + ['playlists','list']
 * (the card title may have changed in the list).
 */
const BEFORE: PlaylistPrimitive = {
  id: 'P1',
  userId: 'U1',
  title: 'Old name',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

function Harness({ id }: { id: string }) {
  const detail = usePlaylist(id);
  const list = usePlaylists();
  const rename = useRenamePlaylist();
  return (
    <div>
      <span data-testid="title">{detail.data?.title ?? '—'}</span>
      <span data-testid="list-count">{list.data?.length ?? 0}</span>
      <button
        data-testid="rename"
        onClick={() => rename.mutateAsync({ id, title: 'New name' })}
      />
    </div>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useRenamePlaylist — PATCH + invalidate detail+list (REQ-FE-014/015)', () => {
  it('PATCHes and invalidates both detail + list', async () => {
    let detailCount = 0;
    let listCount = 0;
    server.use(
      http.get(endpoints.playlists.detail('P1'), () => {
        detailCount += 1;
        return HttpResponse.json(
          detailCount === 1
            ? BEFORE
            : { ...BEFORE, title: 'New name' },
        );
      }),
      http.get(endpoints.playlists.list, () => {
        listCount += 1;
        return HttpResponse.json([]);
      }),
    );
    const patchSpy = vi.fn(() =>
      HttpResponse.json({ ...BEFORE, title: 'New name' }),
    );
    server.use(http.patch(endpoints.playlists.rename('P1'), patchSpy));

    render(<Harness id="P1" />);
    await waitFor(() =>
      expect(screen.getByTestId('title').textContent).toBe('Old name'),
    );

    screen.getByTestId('rename').click();

    await waitFor(() =>
      expect(screen.getByTestId('title').textContent).toBe('New name'),
    );
    expect(patchSpy).toHaveBeenCalledTimes(1);
    // Both the detail + the list were refetched after invalidation.
    expect(detailCount).toBe(2);
    expect(listCount).toBe(2);
  });
});
