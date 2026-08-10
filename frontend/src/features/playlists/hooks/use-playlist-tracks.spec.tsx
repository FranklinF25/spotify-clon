import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { TrackPrimitive } from '@/types/api';
import { usePlaylistTracks } from './use-playlist-tracks';

/**
 * FE-PR3-02 — usePlaylistTracks query (REQ-FE-015; DESIGN §12.2).
 * queryKey ['playlists','tracks',id]; returns the hydrated TrackPrimitive[]
 * (GET /playlists/:id/tracks is OPEN READ; broken refs silent-omitted +
 * survivors re-sorted by position server-side).
 */
function Harness({ id }: { id: string }) {
  const { data, isLoading } = usePlaylistTracks(id);
  if (isLoading || !data) return <div>Loading</div>;
  return <span data-testid="count">{data.length}</span>;
}

const TRACKS: TrackPrimitive[] = [
  { id: 'T1', title: 'So What', durationSeconds: 565, trackNumber: 1, albumId: 'L1' },
  { id: 'T2', title: 'Freddie Freeloader', durationSeconds: 586, trackNumber: 2, albumId: 'L1' },
  { id: 'T3', title: 'Blue in Green', durationSeconds: 335, trackNumber: 3, albumId: 'L1' },
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('usePlaylistTracks — hydrated ordered tracks (REQ-FE-015)', () => {
  it('fetches GET /playlists/:id/tracks and returns hydrated TrackPrimitive[]', async () => {
    server.use(
      http.get(endpoints.playlists.tracks('P1'), () =>
        HttpResponse.json(TRACKS),
      ),
    );
    render(<Harness id="P1" />);
    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('3'),
    );
  });

  it('is disabled (no fetch) when id is empty', async () => {
    render(<Harness id="" />);
    await waitFor(() =>
      expect(screen.getByText('Loading')).toBeInTheDocument(),
    );
  });

  it('handles an empty playlist honestly', async () => {
    server.use(
      http.get(endpoints.playlists.tracks('P1'), () => HttpResponse.json([])),
    );
    render(<Harness id="P1" />);
    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('0'),
    );
  });
});
