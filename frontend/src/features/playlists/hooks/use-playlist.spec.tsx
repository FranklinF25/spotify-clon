import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistPrimitive } from '@/types/api';
import { usePlaylist } from './use-playlist';

/**
 * FE-PR3-02 — usePlaylist query (REQ-FE-015; DESIGN §12.2).
 * queryKey ['playlists','detail',id]; enabled: Boolean(id) — matches useAlbum.
 */
function Harness({ id }: { id: string }) {
  const { data, isLoading } = usePlaylist(id);
  if (isLoading || !data) return <div>Loading</div>;
  return <span data-testid="title">{data.title}</span>;
}

const PLAYLIST: PlaylistPrimitive = {
  id: 'P1',
  userId: 'U1',
  title: 'Road trip',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('usePlaylist — detail (REQ-FE-015)', () => {
  it('fetches GET /playlists/:id', async () => {
    server.use(
      http.get(endpoints.playlists.detail('P1'), () =>
        HttpResponse.json(PLAYLIST),
      ),
    );
    render(<Harness id="P1" />);
    await waitFor(() =>
      expect(screen.getByTestId('title').textContent).toBe('Road trip'),
    );
  });

  it('is disabled (no fetch) when id is empty', async () => {
    render(<Harness id="" />);
    await waitFor(() =>
      expect(screen.getByText('Loading')).toBeInTheDocument(),
    );
  });
});
