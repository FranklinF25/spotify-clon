import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { buildAlbumDetail } from '@/test/fakes';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAlbum } from './use-album';

/**
 * FE-PR3-06 — useAlbum hook (REQ-FE-009; DESIGN §5.1).
 * queryKey ['albums','detail',id]; enabled: Boolean(id). AlbumPage composes
 * this + the TrackList + the "play album" seeding.
 *
 * The MSW default handler generates titles from a seq counter (the server owns
 * the shape, not the request), so these specs override the handler with a
 * KNOWN fixture to assert exact values (mirrors the PR-2 /me-handler gotcha).
 */
function AlbumHarness({ id }: { id: string }) {
  const { data, isLoading } = useAlbum(id);
  if (isLoading || !data) return <div>Loading</div>;
  return (
    <div>
      <span data-testid="album-title">{data.title}</span>
      <span data-testid="track-count">{data.tracks.length}</span>
    </div>
  );
}

const KNOWN = buildAlbumDetail({
  id: 'L1',
  title: 'Led Zeppelin IV',
  tracks: [
    {
      id: 't-a',
      title: 'Black Dog',
      durationSeconds: 297,
      trackNumber: 1,
      albumId: 'L1',
    },
    {
      id: 't-b',
      title: 'Rock and Roll',
      durationSeconds: 221,
      trackNumber: 2,
      albumId: 'L1',
    },
  ],
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useAlbum — album detail + tracks (REQ-FE-009)', () => {
  it('fetches the album detail with embedded tracks', async () => {
    server.use(
      http.get(endpoints.albums.detail('L1'), () =>
        HttpResponse.json(KNOWN),
      ),
    );
    render(<AlbumHarness id="L1" />);
    await waitFor(() =>
      expect(screen.getByTestId('album-title').textContent).toBe(
        'Led Zeppelin IV',
      ),
    );
    expect(screen.getByTestId('track-count').textContent).toBe('2');
  });

  it('is disabled (no fetch) when the id is empty', async () => {
    render(<AlbumHarness id="" />);
    // Should stay in the Loading branch — no query was issued.
    await waitFor(() =>
      expect(screen.getByText('Loading')).toBeInTheDocument(),
    );
  });
});
