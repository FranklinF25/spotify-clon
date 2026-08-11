import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistTrackPrimitive, TrackPrimitive } from '@/types/api';
import { usePlaylistTracks } from './use-playlist-tracks';
import { useAddTrack } from './use-add-track';

/**
 * FE-PR3-02 — useAddTrack mutation.
 * POST /playlists/:id/tracks { trackId } → 201 PlaylistTrackPrimitive.
 * onSuccess invalidates ['playlists','tracks',id].
 */
const T1: TrackPrimitive = { id: 'T1', title: 'A', durationSeconds: 100, trackNumber: 1, albumId: 'L1' };
const T2: TrackPrimitive = { id: 'T2', title: 'B', durationSeconds: 100, trackNumber: 2, albumId: 'L1' };

function Harness({ id }: { id: string }) {
  const tracks = usePlaylistTracks(id);
  const addTrack = useAddTrack();
  return (
    <div>
      <span data-testid="count">{tracks.data?.length ?? 0}</span>
      <button
        data-testid="add"
        onClick={() => addTrack.mutateAsync({ id, trackId: 'T2' })}
      />
    </div>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useAddTrack — POST tracks + invalidate (REQ-FE-015)', () => {
  it('POSTs and invalidates ["playlists","tracks",id] (refetch fires)', async () => {
    let tracksCount = 0;
    server.use(
      http.get(endpoints.playlists.tracks('P1'), () => {
        tracksCount += 1;
        return HttpResponse.json(tracksCount === 1 ? [T1] : [T1, T2]);
      }),
    );
    const postSpy = vi.fn(() =>
      HttpResponse.json(
        { position: 2, trackId: 'T2', addedAt: '2025-01-01T00:00:00.000Z' } satisfies PlaylistTrackPrimitive,
        { status: 201 },
      ),
    );
    server.use(http.post(endpoints.playlists.addTrack('P1'), postSpy));

    render(<Harness id="P1" />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));

    screen.getByTestId('add').click();

    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('2'),
    );
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(tracksCount).toBe(2); // initial + refetch after invalidation
  });
});
