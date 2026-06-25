import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/test/msw/server';
import { useAuthStore } from '@/store/auth.store';
import { usePlayerStore } from '@/store/player.store';
import type { TrackPrimitive } from '@/types/api';
import { useAudioSource } from './use-audio-source';

/**
 * FE-PR4-01 — useAudioSource (REQ-FE-012, DESIGN §5.2 + §6.3).
 *
 * The Blob-URL lifecycle hook co-located with PlayerBar (JD fix #9 — no
 * component imports from features/). Owns the six lifecycle invariants
 * (DESIGN §6.3):
 *   1. one active blob URL per PlayerBar instance,
 *   2. revoke on track change,
 *   3. revoke on unmount,
 *   4. no double-revoke (the `revoked` race guard),
 *   5. no leak on fetch failure (catch sets src=null without minting),
 *   6. PlayerBar mounted once (covered by FE-PR4-04's AppLayout runtime test).
 *
 * jsdom notes: HTMLMediaElement is a stub here. We do NOT exercise real
 * decoding; we assert the SEAM — that `currentTrack.id` drives a fresh
 * `loadBlobSource` call + the resulting URL is returned, and that revoke
 * is invoked exactly the right number of times across the lifecycle.
 */

const trackA: TrackPrimitive = {
  id: 'track-a',
  title: 'Track A',
  durationSeconds: 100,
  trackNumber: 1,
  albumId: 'album-1',
};
const trackB: TrackPrimitive = {
  id: 'track-b',
  title: 'Track B',
  durationSeconds: 120,
  trackNumber: 2,
  albumId: 'album-1',
};

/** Harness so the hook runs inside a component lifecycle. */
function Harness({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

/** Render the hook and surface its current value via a ref + callback. */
function renderHook() {
  let current: string | null = null;
  function Reader() {
    current = useAudioSource();
    return null;
  }
  const utils = render(
    <Harness>
      <Reader />
    </Harness>,
  );
  return {
    get value() {
      return current;
    },
    rerender: utils.rerender,
    unmount: utils.unmount,
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useAuthStore.setState({ accessToken: null });
  vi.mocked(URL.createObjectURL).mockClear();
  vi.mocked(URL.revokeObjectURL).mockClear();
});
afterAll(() => server.close());

describe('useAudioSource — Blob-URL lifecycle (REQ-FE-012)', () => {
  it('returns null and fetches nothing when there is no current track', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    // No track in the queue.
    const result = renderHook();
    // No URL minted, no fetch issued.
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(result.value).toBeNull();
    result.unmount();
  });

  it('returns a blob: URL for the current track (invariant #1: one active URL)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    usePlayerStore.setState({
      queue: [trackA],
      currentIndex: 0,
    });
    const result = renderHook();
    // The stream resolves asynchronously — let the microtask settle.
    await vi.waitFor(() => {
      expect(result.value).not.toBeNull();
    });
    expect(result.value?.startsWith('blob:')).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    result.unmount();
  });

  it('revokes the previous URL when the track changes (invariant #2)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    // Distinct URLs per track so the revoke target is unambiguous.
    let seq = 0;
    server.use(
      http.get('/api/v1/tracks/:id/stream', () => {
        seq += 1;
        return new HttpResponse(new Uint8Array([seq]), {
          headers: { 'content-type': 'audio/mpeg' },
        });
      }),
    );

    // Seed track A.
    usePlayerStore.setState({ queue: [trackA], currentIndex: 0 });
    const result = renderHook();
    await vi.waitFor(() => expect(result.value).not.toBeNull());
    const firstUrl = result.value;
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    // Swap to track B.
    usePlayerStore.setState({ queue: [trackA, trackB], currentIndex: 1 });
    await vi.waitFor(() => expect(result.value).not.toBeNull());
    await vi.waitFor(() => expect(result.value).not.toBe(firstUrl));

    // The previous URL MUST have been revoked exactly once.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    // Only one active URL remains — the new one.
    const revokeCalls = vi.mocked(URL.revokeObjectURL).mock.calls.map((c) => c[0]);
    const createCalls = vi.mocked(URL.createObjectURL).mock.calls.length;
    // createCalls == 2 (trackA + trackB); revokeCalls == 1 (trackA revoked, trackB still active).
    expect(createCalls).toBe(2);
    expect(revokeCalls).toHaveLength(1);
    result.unmount();
  });

  it('revokes the active URL on unmount (invariant #3)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    usePlayerStore.setState({ queue: [trackA], currentIndex: 0 });
    const result = renderHook();
    await vi.waitFor(() => expect(result.value).not.toBeNull());
    const activeUrl = result.value;

    result.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(activeUrl);
  });

  it('does not leak a URL on fetch failure (invariant #5)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    server.use(
      http.get('/api/v1/tracks/:id/stream', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'gone' } },
          { status: 404 },
        ),
      ),
    );
    usePlayerStore.setState({ queue: [trackA], currentIndex: 0 });
    const result = renderHook();
    // The catch branch should leave src=null and never mint a URL.
    await vi.waitFor(() => expect(URL.createObjectURL).not.toHaveBeenCalled());
    expect(result.value).toBeNull();
    result.unmount();
    // No revoke needed because nothing was minted.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('never revokes the same URL twice across track-change + unmount (invariant #4)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    usePlayerStore.setState({ queue: [trackA], currentIndex: 0 });

    const result = renderHook();
    await vi.waitFor(() => expect(result.value).not.toBeNull());

    // Swap to a second track → previous URL revoked exactly once.
    usePlayerStore.setState({ queue: [trackA, trackB], currentIndex: 1 });
    await vi.waitFor(() => expect(result.value).not.toBeNull());

    // Unmount → the active URL revoked exactly once.
    result.unmount();

    const revokeCalls = vi.mocked(URL.revokeObjectURL).mock.calls.map((c) => c[0]);
    // No URL appears twice in the revoke list — the `revoked` race guard
    // blocks both the track-change cleanup AND the unmount cleanup from
    // revoking the same URL twice.
    const counts = new Map<string, number>();
    for (const url of revokeCalls) counts.set(url, (counts.get(url) ?? 0) + 1);
    for (const [url, n] of counts) expect(n, `URL ${url} revoked ${n} times`).toBe(1);
  });

  it('does not refetch on token rotation (no accessToken in the dep array)', async () => {
    // The hook reads `useAuthStore.getState().accessToken` imperatively
    // inside the effect. Adding `accessToken` to the dep array would orphan
    // a valid blob mid-playback on every refresh. Verify by rotating the
    // token AFTER the URL is set + asserting the hook does NOT issue a
    // second fetch.
    useAuthStore.setState({ accessToken: 'token-1' });
    usePlayerStore.setState({ queue: [trackA], currentIndex: 0 });

    let streamCalls = 0;
    server.use(
      http.get('/api/v1/tracks/:id/stream', () => {
        streamCalls += 1;
        return new HttpResponse(new Uint8Array([1]), {
          headers: { 'content-type': 'audio/mpeg' },
        });
      }),
    );

    const result = renderHook();
    await vi.waitFor(() => {
      expect(streamCalls).toBe(1);
      expect(result.value).not.toBeNull();
    });
    const firstUrl = result.value;

    // Rotate the token WITHOUT changing the track. The hook MUST NOT refetch.
    useAuthStore.setState({ accessToken: 'token-2-rotated' });
    // Allow any pending microtasks to settle.
    await vi.waitFor(() => expect(streamCalls).toBe(1));
    expect(result.value).toBe(firstUrl); // the same URL is still active

    result.unmount();
  });

  it('threads the AbortController signal to loadBlobSource on cleanup', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    usePlayerStore.setState({ queue: [trackA], currentIndex: 0 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = renderHook();
    await vi.waitFor(() => expect(result.value).not.toBeNull());

    // Trigger the cleanup by unmounting → the controller.abort() must run.
    result.unmount();

    // The fetch for the stream was made; we can't directly assert the abort
    // fired after-the-fact, but we confirm the signal was threaded by
    // inspecting the RequestInit of the stream call.
    const streamCall = fetchSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/stream'),
    );
    expect(streamCall).toBeDefined();
    const opts = streamCall![1] as RequestInit;
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    fetchSpy.mockRestore();
  });
});
