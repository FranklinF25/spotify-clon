import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { render } from '@/test/render';
import { useAuthStore } from '@/store/auth.store';
import { usePlayerStore } from '@/store/player.store';
import type { TrackPrimitive } from '@/types/api';
import { PlayerBar } from './PlayerBar';

/**
 * FE-PR4-02 — PlayerBar organism (REQ-FE-011, REQ-FE-012, DESIGN §6.2).
 *
 * The portfolio payload: the `<audio>` sync seam. PlayerBar owns the
 * `<audio>` ref (NOT any store) + runs two unidirectional syncs:
 *   - store → element via effects (src, isPlaying, volume, currentTime seek)
 *   - element → store via events (onTimeUpdate, onDurationChange, onEnded,
 *     onPlay, onPause)
 *
 * The full DESIGN §10 self-check suite lives here. jsdom's HTMLAudioElement
 * is a stub (no real decoding, paused=true always) — we test the SEAM:
 * handlers fire, store + element converge, feedback-loop guards hold.
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
const trackC: TrackPrimitive = {
  id: 'track-c',
  title: 'Track C',
  durationSeconds: 90,
  trackNumber: 3,
  albumId: 'album-1',
};

function withQueue(...tracks: TrackPrimitive[]) {
  usePlayerStore.setState({
    queue: tracks,
    currentIndex: 0,
    currentTime: 0,
    // Default duration to a non-zero value so jsdom does not clamp range
    // input commits to 0 (max=0 clamps every commit). Real flows set the
    // duration from onDurationChange; tests assert the seam directly.
    duration: 100,
    isPlaying: false,
  });
}

function Provider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useAuthStore.setState({ accessToken: null });
  vi.mocked(URL.createObjectURL).mockClear();
  vi.mocked(URL.revokeObjectURL).mockClear();
  usePlayerStore.setState({
    queue: [],
    currentIndex: -1,
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    volume: 0.8,
  });
});
afterAll(() => server.close());

/** Grab the single <audio> element rendered by PlayerBar. */
function audio(): HTMLAudioElement {
  return screen.getByTestId('player-audio') as unknown as HTMLAudioElement;
}

describe('PlayerBar — store → element sync (REQ-FE-011)', () => {
  it('renders the audio element + transport controls (landmarks)', () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    expect(screen.getByRole('region', { name: /player/i })).toBeInTheDocument();
    expect(audio()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /play|pause/i }),
    ).toBeInTheDocument();
  });

  it('toggling play/pause flips isPlaying AND drives the audio element', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    // Wait for the blob URL to land on the audio element.
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));
    // jsdom HTMLAudioElement.play resolves + fires 'play' event.
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause');

    fireEvent.click(screen.getByRole('button', { name: /play|pause/i }));
    await waitFor(() => expect(usePlayerStore.getState().isPlaying).toBe(true));
    expect(playSpy).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /play|pause/i }));
    await waitFor(() => expect(usePlayerStore.getState().isPlaying).toBe(false));
    expect(pauseSpy).toHaveBeenCalled();

    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it('volume effect writes through to the audio element (clamped upstream)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));

    usePlayerStore.getState().setVolume(0.4);
    await waitFor(() => expect(audio().volume).toBeCloseTo(0.4, 5));

    // Clamp at 0 (store owns the clamp; element just mirrors).
    usePlayerStore.getState().setVolume(-1);
    await waitFor(() => expect(audio().volume).toBe(0));
  });
});

describe('PlayerBar — seek + duration guards (JD fix #5 + #13 + #15)', () => {
  it('SeekBar max tracks setDuration (JD fix #5: duration MUST be subscribed)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    // Reset duration to 0 so we can assert it tracks a real change.
    usePlayerStore.setState({ duration: 0 });
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));

    const seek = screen.getByRole('slider', { name: /seek/i }) as HTMLInputElement;
    expect(seek.max).toBe('0'); // initial duration 0

    // setDuration on the store → SeekBar max follows (JD fix #5: duration
    // MUST be subscribed or this re-render would not happen).
    usePlayerStore.getState().setDuration(180);
    await waitFor(() => expect(seek.max).toBe('180'));
  });

  it('onDurationChange with Infinity is rejected (JD fix #15: Number.isFinite guard)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));

    // Simulate a blob source that fires Infinity before metadata settles.
    Object.defineProperty(audio(), 'duration', {
      configurable: true,
      value: Infinity,
    });
    fireEvent(audio(), new Event('durationchange'));

    // The store MUST NOT receive Infinity — SeekBar stays usable.
    expect(usePlayerStore.getState().duration).not.toBe(Infinity);

    // A finite value still passes through.
    Object.defineProperty(audio(), 'duration', { configurable: true, value: 90 });
    fireEvent(audio(), new Event('durationchange'));
    await waitFor(() => expect(usePlayerStore.getState().duration).toBe(90));
  });

  it('scrubbing suppresses onTimeUpdate writes (JD fix #13: no drag fight)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));

    const seek = screen.getByRole('slider', { name: /seek/i }) as HTMLInputElement;
    const before = usePlayerStore.getState().currentTime;

    // Start dragging.
    fireEvent.pointerDown(seek);
    // Element emits timeupdate during the drag — PlayerBar MUST skip it.
    Object.defineProperty(audio(), 'currentTime', {
      configurable: true,
      writable: true,
      value: 12.5,
    });
    fireEvent(audio(), new Event('timeupdate'));
    // The store was NOT updated from timeupdate during the drag.
    expect(usePlayerStore.getState().currentTime).toBe(before);

    // Commit the drag → setCurrentTime fires once with the commit value.
    fireEvent.change(seek, { target: { value: '30' } });
    fireEvent.pointerUp(seek);
    await waitFor(() =>
      expect(usePlayerStore.getState().currentTime).toBe(30),
    );
  });

  it('a user seek commit writes through to the element even when < 0.5s (isUserSeeking branch)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));

    // Set the element's currentTime near the commit value so the 0.5s delta
    // loop-prevention guard would NORMALLY swallow a small delta. writable
    // so the seek effect can still assign through to the element.
    Object.defineProperty(audio(), 'currentTime', {
      configurable: true,
      writable: true,
      value: 10.1,
    });

    const seek = screen.getByRole('slider', { name: /seek/i }) as HTMLInputElement;
    // A user commit to 10.3 (delta 0.2 < 0.5) MUST still write through.
    fireEvent.pointerDown(seek);
    fireEvent.change(seek, { target: { value: '10.3' } });
    fireEvent.pointerUp(seek);
    // The element's currentTime followed the commit (within isUserSeeking).
    await waitFor(() => expect(audio().currentTime).toBe(10.3));
  });
});

describe('PlayerBar — el.play() rejection surface (JD fix #14 + R2-11)', () => {
  it('flips isPlaying=false + renders TapToPlayOverlay when play() rejects', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    // Force HTMLAudioElement.play to reject (autoplay policy simulation).
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new DOMException('not allowed', 'NotAllowedError'));

    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));

    // Trigger play: store flips isPlaying → effect calls el.play() → rejects
    // → setPlayBlocked(true) + store.pause() → TapToPlayOverlay renders.
    usePlayerStore.getState().play();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /tap to play/i }),
      ).toBeInTheDocument(),
    );
    // Store was kept honest (the rejection did not leave isPlaying=true).
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    playSpy.mockRestore();
  });

  it('TapToPlayOverlay click clears the overlay + retries play', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    // First call rejects; subsequent calls succeed (the user gesture unblocks).
    let rejected = true;
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => {
        if (rejected) {
          rejected = false;
          return Promise.reject(
            new DOMException('not allowed', 'NotAllowedError'),
          );
        }
        return Promise.resolve();
      });

    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));
    usePlayerStore.getState().play();
    const overlay = await screen.findByRole('button', { name: /tap to play/i });
    fireEvent.click(overlay);
    // Overlay is gone + play succeeded on the retry.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /tap to play/i }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(usePlayerStore.getState().isPlaying).toBe(true),
    );
    playSpy.mockRestore();
  });

  // Play-race regression 1: the pending-play abort. In a real browser,
  // el.play() with NO source pends forever; assigning el.src (the blob
  // URL arriving) rejects that pending promise with AbortError. That abort
  // is the track-change path and MUST NOT pause the store or surface the
  // overlay — only genuine failures (NotAllowedError et al.) do.
  it('AbortError from play() is NOT surfaced (no pause, no overlay)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new DOMException('aborted', 'AbortError'));

    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));
    usePlayerStore.getState().play();
    await waitFor(() => expect(playSpy).toHaveBeenCalled());
    // Give the microtask queue a beat to run any (wrong) catch handler.
    await act(async () => {
      await Promise.resolve();
    });
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(
      screen.queryByRole('button', { name: /tap to play/i }),
    ).not.toBeInTheDocument();
    playSpy.mockRestore();
  });

  // Play-race regression 2: play() MUST NOT be called while no source is
  // attached. Without the blob (no access token), src stays '' — a play()
  // there pends forever and then AbortErrors when the blob arrives.
  it('isPlaying=true with no source does NOT call el.play()', async () => {
    useAuthStore.setState({ accessToken: null }); // no token → no blob URL
    withQueue(trackA);
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);

    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await act(async () => {
      usePlayerStore.getState().play();
      await Promise.resolve();
    });
    expect(playSpy).not.toHaveBeenCalled();
    // The store intent is preserved — the [src] effect owns the start.
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    playSpy.mockRestore();
  });
});

describe('PlayerBar — element → store events (REQ-FE-011)', () => {
  it('onEnded at last track stops playback without wrapping to index 0', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA, trackB, trackC);
    usePlayerStore.setState({ currentIndex: 2, isPlaying: true });
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));

    fireEvent(audio(), new Event('ended'));
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    // End-of-queue: no wrap (REQ-FE-011 scenario "End-of-queue stops playback").
    expect(usePlayerStore.getState().currentIndex).toBe(2);
  });

  it('Next button walks the queue; stops at end without wrapping', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA, trackB, trackC);
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(usePlayerStore.getState().currentIndex).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(usePlayerStore.getState().currentIndex).toBe(2); // stops at end
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('Prev button walks back; clamps at 0', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA, trackB, trackC);
    usePlayerStore.setState({ currentIndex: 2 });
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));

    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(usePlayerStore.getState().currentIndex).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(usePlayerStore.getState().currentIndex).toBe(0); // clamps at 0
  });
});

describe('PlayerBar — Blob URL lifecycle cross-check (REQ-FE-012)', () => {
  it('track change revokes the previous blob URL', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));
    const firstSrc = audio().src;

    // Switch track → previous URL revoked + new src set.
    usePlayerStore.setState({ queue: [trackA, trackB], currentIndex: 1 });
    await waitFor(() => expect(audio().src).not.toBe(firstSrc));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstSrc);
  });

  it('the audio src is a blob: URL fetched with the Bearer header (REQ-FE-012 scenario 1)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    // Capture the outgoing stream request to assert Authorization is set.
    let seenAuth = '';
    server.use(
      http.get('/api/v1/tracks/:id/stream', ({ request }) => {
        seenAuth = request.headers.get('authorization') ?? '';
        return new HttpResponse(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg' },
        });
      }),
    );
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));
    await waitFor(() => expect(seenAuth).toBe('Bearer T'));
  });

  it('no HTTP Range header is sent to /tracks/:id/stream (known limitation, REQ-FE-012)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    withQueue(trackA);
    let seenRange: string | null | undefined = '__sentinel__';
    server.use(
      http.get('/api/v1/tracks/:id/stream', ({ request }) => {
        // Capture the raw value — do NOT coalesce with `??` (null coalescing
        // would keep the sentinel for null, hiding the real value).
        seenRange = request.headers.get('range');
        return new HttpResponse(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg' },
        });
      }),
    );
    render(
      <Provider>
        <PlayerBar />
      </Provider>,
    );
    await waitFor(() => expect(audio().src).toMatch(/^blob:/));
    // The blob is pre-fetched whole; Range is NOT driven through the browser.
    await waitFor(() => expect(seenRange).toBeNull());
  });
});
