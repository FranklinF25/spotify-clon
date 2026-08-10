import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { TrackPrimitive } from '@/types/api';
import { usePlaylistTracks } from './use-playlist-tracks';
import { useRemoveTrack } from './use-remove-track';

/**
 * FE-PR3-02 — useRemoveTrack mutation.
 * DELETE /playlists/:id/tracks/:position → 204 (compact-on-remove).
 * onSuccess invalidates ['playlists','tracks',id]; the refetch renders the
 * compacted positions (server-side source of truth).
 */
const T1: TrackPrimitive = { id: 'T1', title: 'A', durationSeconds: 100, trackNumber: 1, albumId: 'L1' };
const T2: TrackPrimitive = { id: 'T2', title: 'B', durationSeconds: 100, trackNumber: 2, albumId: 'L1' };
const T3: TrackPrimitive = { id: 'T3', title: 'C', durationSeconds: 100, trackNumber: 3, albumId: 'L1' };

function Harness({ id, position }: { id: string; position: number }) {
  const tracks = usePlaylistTracks(id);
  const removeTrack = useRemoveTrack();
  return (
    <div>
      <span data-testid="count">{tracks.data?.length ?? 0}</span>
      <button
        data-testid="remove"
        onClick={() => removeTrack.mutateAsync({ id, position })}
      />
    </div>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useRemoveTrack — DELETE tracks/:position + invalidate (REQ-FE-015)', () => {
  it('DELETEs and invalidates ["playlists","tracks",id] (compact-on-remove refetch)', async () => {
    let tracksCount = 0;
    server.use(
      http.get(endpoints.playlists.tracks('P1'), () => {
        tracksCount += 1;
        // After remove(position 2): [T1, T3] (T3 compacted to position 2).
        return HttpResponse.json(
          tracksCount === 1 ? [T1, T2, T3] : [T1, T3],
        );
      }),
    );
    const deleteSpy = vi.fn(() => new HttpResponse(null, { status: 204 }));
    server.use(
      http.delete(endpoints.playlists.removeTrack('P1', 2), deleteSpy),
    );

    render(<Harness id="P1" position={2} />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'));

    screen.getByTestId('remove').click();

    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('2'),
    );
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(tracksCount).toBe(2); // initial + refetch after invalidation
  });
});
