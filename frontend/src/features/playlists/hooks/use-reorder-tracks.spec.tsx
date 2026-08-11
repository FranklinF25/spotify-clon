import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistTrackPrimitive, TrackPrimitive } from '@/types/api';
import { usePlaylistTracks } from './use-playlist-tracks';
import { useReorderTracks } from './use-reorder-tracks';

/**
 * FE-PR3-02 — useReorderTracks mutation (LOCKED design R6).
 *
 * The reorder is the ONLY mutation whose invalidation is `onSettled` (NOT
 * `onSuccess` / `onMutate`) and which MUST NOT apply an optimistic update.
 * The insert-and-shift is NOT reimplemented client-side; the server stays the
 * single source of truth. The spec proves:
 *  1. onSettled invalidates ['playlists','tracks',id] (refetch fires).
 *  2. NO onMutate — the cache data is UNCHANGED between the mutate call and
 *     the POST resolution (a deferred handler gates the resolution so the
 *     "before" window is observable; an optimistic onMutate would have
 *     rewritten the cache synchronously).
 */
const A: TrackPrimitive = { id: 'A', title: 'A', durationSeconds: 100, trackNumber: 1, albumId: 'L1' };
const B: TrackPrimitive = { id: 'B', title: 'B', durationSeconds: 100, trackNumber: 2, albumId: 'L1' };
const C: TrackPrimitive = { id: 'C', title: 'C', durationSeconds: 100, trackNumber: 3, albumId: 'L1' };
const D: TrackPrimitive = { id: 'D', title: 'D', durationSeconds: 100, trackNumber: 4, albumId: 'L1' };
const ORIGINAL = [A, B, C, D];
const REORDERED = [A, C, D, B]; // from=2 to=4 → insert-and-shift

function Harness({ id }: { id: string }) {
  const tracks = usePlaylistTracks(id);
  const reorder = useReorderTracks();
  return (
    <div>
      <span data-testid="order">
        {(tracks.data ?? []).map((t) => t.id).join(',')}
      </span>
      <button
        data-testid="reorder"
        onClick={() => reorder.mutateAsync({ id, from: 2, to: 4 })}
      />
    </div>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useReorderTracks — refetch-after-settle, NO optimistic UI (design R6)', () => {
  it('invalidates ["playlists","tracks",id] on settle (refetch fires)', async () => {
    let tracksCount = 0;
    server.use(
      http.get(endpoints.playlists.tracks('P1'), () => {
        tracksCount += 1;
        return HttpResponse.json(
          tracksCount === 1 ? ORIGINAL : REORDERED,
        );
      }),
    );
    const postSpy = vi.fn(() =>
      HttpResponse.json(
        [
          { position: 1, trackId: 'A', addedAt: '2025-01-01T00:00:00.000Z' },
          { position: 2, trackId: 'C', addedAt: '2025-01-01T00:00:00.000Z' },
          { position: 3, trackId: 'D', addedAt: '2025-01-01T00:00:00.000Z' },
          { position: 4, trackId: 'B', addedAt: '2025-01-01T00:00:00.000Z' },
        ] satisfies PlaylistTrackPrimitive[],
        { status: 200 },
      ),
    );
    server.use(http.post(endpoints.playlists.reorder('P1'), postSpy));

    render(<Harness id="P1" />);
    await waitFor(() =>
      expect(screen.getByTestId('order').textContent).toBe('A,B,C,D'),
    );

    screen.getByTestId('reorder').click();

    await waitFor(() =>
      expect(screen.getByTestId('order').textContent).toBe('A,C,D,B'),
    );
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(tracksCount).toBe(2); // initial + onSettled refetch
  });

  it('does NOT call onMutate — cache is UNCHANGED before the POST resolves', async () => {
    let tracksCount = 0;
    server.use(
      http.get(endpoints.playlists.tracks('P1'), () => {
        tracksCount += 1;
        return HttpResponse.json(ORIGINAL);
      }),
    );

    // Deferred POST handler: we control WHEN it resolves so the "before
    // resolution" window is observable. An optimistic onMutate would have
    // rewritten the cache synchronously at mutate-call time.
    // Definite-assignment: TS cannot see the async callback assigns this, but
    // the POST request arrives (and the callback runs) before we call it.
    let resolvePost!: () => void;
    server.use(
      http.post(endpoints.playlists.reorder('P1'), async () => {
        await new Promise<void>((resolve) => {
          resolvePost = resolve;
        });
        return HttpResponse.json([], { status: 200 });
      }),
    );

    const { queryClient } = render(<Harness id="P1" />);
    await waitFor(() =>
      expect(screen.getByTestId('order').textContent).toBe('A,B,C,D'),
    );
    expect(tracksCount).toBe(1);

    // Trigger reorder — the POST is now in flight (gated on resolvePost).
    screen.getByTestId('reorder').click();
    // Yield microtasks so the mutate + any synchronous onMutate would land.
    await new Promise((r) => setTimeout(r, 10));

    // KEY ASSERTION (design R6): the cache is UNCHANGED before the POST
    // resolves. If onMutate existed, it would have synchronously rewritten
    // the ['playlists','tracks',P1] cache to a client-computed order.
    expect(queryClient.getQueryData(['playlists', 'tracks', 'P1'])).toEqual(
      ORIGINAL,
    );
    expect(screen.getByTestId('order').textContent).toBe('A,B,C,D');

    // Release the POST → onSettled fires → invalidate → refetch. Drain the
    // full settle cycle so no state update leaks past test cleanup.
    resolvePost();
    await waitFor(() => expect(tracksCount).toBe(2));
  });
});
