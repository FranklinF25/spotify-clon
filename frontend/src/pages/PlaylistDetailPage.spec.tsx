import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import { usePlayerStore } from '@/store/player.store';
import { RequireAuth } from '@/app/RequireAuth';
import type { PlaylistPrimitive, TrackPrimitive } from '@/types/api';
import { PlaylistDetailPage } from './PlaylistDetailPage';

/**
 * FE-PR3-04 — PlaylistDetailPage (REQ-FE-015) integration.
 *
 * Composes PlaylistHeader + PlaylistTrackList + AddTrackPicker (FE-PR5 UX
 * fix: search-to-add replaced the old paste-a-track-UUID AddTrackForm). The
 * "Play playlist" handoff is the entire playback integration:
 *   const onPlay = () => playFromList(tracks, 0);
 * `playFromList` is REUSED UNCHANGED from playerStore (zero store change).
 *
 * The picker add-flow tests run on REAL timers (the 300ms debounce elapses
 * inside waitFor) and drive the full MSW chain: /search?type=track →
 * POST /playlists/:id/tracks → tracks-cache invalidation → refetch. The
 * search-result row title is DELIBERATELY different from the appended
 * TrackPrimitive title ("New Song" vs "Song T4") so getByText never sees
 * the picker row and the playlist row as one ambiguous match.
 *
 * Route mounting mirrors PlaylistsPage.spec.tsx: `/login` is a SIBLING outside
 * `<RequireAuth>` so an unauthenticated redirect cannot loop infinitely
 * (RequireAuth → /login matches inside RequireAuth → redirect again → hang).
 */
const P1: PlaylistPrimitive = {
  id: 'P1',
  userId: 'u',
  title: 'Road trip',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const track = (id: string): TrackPrimitive => ({
  id,
  title: `Song ${id}`,
  durationSeconds: 180,
  trackNumber: 1,
  albumId: 'L1',
});
const T1 = track('T1');
const T2 = track('T2');
const T3 = track('T3');

const AUTHED = {
  status: 'authenticated' as const,
  user: { id: 'u', email: 'a@b.co', displayName: 'A' },
  accessToken: 'tok',
  bootRefreshStarted: false,
};

function mountPage(id = 'P1') {
  useAuthStore.setState(AUTHED);
  return render(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
      </Route>
      {/* /login SIBLING outside RequireAuth (see file header — avoids the
          infinite redirect loop that hangs vitest). */}
      <Route path="/login" element={<div data-testid="login-page" />} />
    </Routes>,
    { routeInitialEntries: [`/playlists/${id}`] },
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  // Reset the player store so a prior test's queue doesn't leak.
  usePlayerStore.setState({
    queue: [],
    currentIndex: -1,
    isPlaying: false,
  });
});
afterAll(() => server.close());

describe('PlaylistDetailPage (REQ-FE-015)', () => {
  it('renders the playlist title + ordered tracks from the two caches', async () => {
    server.use(
      http.get(endpoints.playlists.detail('P1'), () => HttpResponse.json(P1)),
      http.get(endpoints.playlists.tracks('P1'), () =>
        HttpResponse.json([T1, T2, T3]),
      ),
    );
    mountPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Road trip' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Song T1')).toBeInTheDocument();
    expect(screen.getByText('Song T2')).toBeInTheDocument();
    expect(screen.getByText('Song T3')).toBeInTheDocument();
  });

  it('Play playlist seeds the queue via playFromList(tracks, 0)', async () => {
    server.use(
      http.get(endpoints.playlists.detail('P1'), () => HttpResponse.json(P1)),
      http.get(endpoints.playlists.tracks('P1'), () =>
        HttpResponse.json([T1, T2, T3]),
      ),
    );
    mountPage();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /play playlist/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /play playlist/i }));
    const s = usePlayerStore.getState();
    expect(s.queue).toEqual([T1, T2, T3]);
    expect(s.currentIndex).toBe(0);
    expect(s.isPlaying).toBe(true);
  });

  it('adding a track via the picker invalidates the tracks cache and appends T4', async () => {
    let calls = 0;
    let seenType: string | null = null;
    server.use(
      http.get(endpoints.playlists.detail('P1'), () => HttpResponse.json(P1)),
      http.get(endpoints.playlists.tracks('P1'), () => {
        calls += 1;
        return HttpResponse.json(
          calls === 1 ? [T1, T2, T3] : [T1, T2, T3, track('T4')],
        );
      }),
      http.post(endpoints.playlists.addTrack('P1'), () =>
        HttpResponse.json(
          { position: 4, trackId: 'T4', addedAt: '2025-01-01T00:00:00.000Z' },
          { status: 201 },
        ),
      ),
      // The picker's debounced search → page adapter fetchQuery with the
      // SINGULAR type param (same contract as use-search.spec).
      http.get('/api/v1/search', ({ request }) => {
        const url = new URL(request.url);
        seenType = url.searchParams.get('type');
        return HttpResponse.json({
          artists: [],
          albums: [],
          tracks: [
            {
              id: 'T4',
              title: 'New Song',
              durationSeconds: 180,
              albumId: 'L1',
            },
          ],
        });
      }),
    );
    mountPage();
    await waitFor(() =>
      expect(screen.getByText('Song T3')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/search tracks/i), {
      target: { value: 'New Song' },
    });
    // Real timers: the 300ms debounce elapses inside waitFor.
    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: 'Add New Song' }),
        ).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(seenType).toBe('track');
    fireEvent.click(screen.getByRole('button', { name: 'Add New Song' }));
    await waitFor(() =>
      expect(screen.getByText('Song T4')).toBeInTheDocument(),
    );
  });

  it('removing position 2 invalidates and re-renders compacted', async () => {
    let calls = 0;
    server.use(
      http.get(endpoints.playlists.detail('P1'), () => HttpResponse.json(P1)),
      http.get(endpoints.playlists.tracks('P1'), () => {
        calls += 1;
        return HttpResponse.json(calls === 1 ? [T1, T2, T3] : [T1, T3]);
      }),
      http.delete(
        endpoints.playlists.removeTrack('P1', 2),
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    mountPage();
    await waitFor(() =>
      expect(screen.getByText('Song T2')).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /remove Song T2/i }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Song T2')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Song T3')).toBeInTheDocument();
  });

  it('reordering invalidates and re-renders the new order', async () => {
    let calls = 0;
    server.use(
      http.get(endpoints.playlists.detail('P1'), () => HttpResponse.json(P1)),
      http.get(endpoints.playlists.tracks('P1'), () => {
        calls += 1;
        return HttpResponse.json(calls === 1 ? [T1, T2, T3] : [T2, T1, T3]);
      }),
      http.post(endpoints.playlists.reorder('P1'), () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );
    mountPage();
    await waitFor(() =>
      expect(screen.getByText('Song T1')).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /move Song T1 down/i }),
    );
    await waitFor(() => expect(calls).toBe(2)); // invalidated → refetch
    // both still rendered (new order); no crash.
    expect(screen.getByText('Song T1')).toBeInTheDocument();
    expect(screen.getByText('Song T2')).toBeInTheDocument();
  });

  it('renders an honest not-found state on 404 (no crash)', async () => {
    server.use(
      http.get(endpoints.playlists.detail('nope'), () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'gone' } },
          { status: 404 },
        ),
      ),
      http.get(endpoints.playlists.tracks('nope'), () =>
        HttpResponse.json([]),
      ),
    );
    mountPage('nope');
    await waitFor(() =>
      expect(
        screen.getByText(/couldn't find that playlist/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('Road trip')).not.toBeInTheDocument();
  });

  it('surfaces a 403 on non-owner remove and leaves the list unchanged', async () => {
    server.use(
      http.get(endpoints.playlists.detail('P1'), () => HttpResponse.json(P1)),
      http.get(endpoints.playlists.tracks('P1'), () =>
        HttpResponse.json([T1, T2, T3]),
      ),
      http.delete(endpoints.playlists.removeTrack('P1', 2), () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'not yours' } },
          { status: 403 },
        ),
      ),
    );
    mountPage();
    await waitFor(() =>
      expect(screen.getByText('Song T2')).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /remove Song T2/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/you are not the owner/i)).toBeInTheDocument(),
    );
    // NOT optimistically mutated.
    expect(screen.getByText('Song T1')).toBeInTheDocument();
    expect(screen.getByText('Song T2')).toBeInTheDocument();
    expect(screen.getByText('Song T3')).toBeInTheDocument();
  });

  it('surfaces a 422 on unknown trackId add (picker row)', async () => {
    server.use(
      http.get(endpoints.playlists.detail('P1'), () => HttpResponse.json(P1)),
      http.get(endpoints.playlists.tracks('P1'), () =>
        HttpResponse.json([T1]),
      ),
      http.post(endpoints.playlists.addTrack('P1'), () =>
        HttpResponse.json(
          { error: { code: 'UNPROCESSABLE_ENTITY', message: 'unknown track' } },
          { status: 422 },
        ),
      ),
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          artists: [],
          albums: [],
          tracks: [
            {
              id: 'T-NOPE',
              title: 'Ghost Song',
              durationSeconds: 180,
              albumId: 'L1',
            },
          ],
        }),
      ),
    );
    mountPage();
    await waitFor(() =>
      expect(screen.getByText('Song T1')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/search tracks/i), {
      target: { value: 'Ghost Song' },
    });
    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: 'Add Ghost Song' }),
        ).toBeInTheDocument(),
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add Ghost Song' }));
    await waitFor(() =>
      expect(screen.getByText(/track not found/i)).toBeInTheDocument(),
    );
  });

  it('end-of-queue stops playback (reused REQ-FE-011 contract)', async () => {
    server.use(
      http.get(endpoints.playlists.detail('P1'), () => HttpResponse.json(P1)),
      http.get(endpoints.playlists.tracks('P1'), () =>
        HttpResponse.json([T1, T2, T3]),
      ),
    );
    mountPage();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /play playlist/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /play playlist/i }));
    const store = usePlayerStore.getState();
    store.next(); // → index 1
    store.next(); // → index 2 (last)
    store.next(); // end → STOP (no wrap)
    const s = usePlayerStore.getState();
    expect(s.currentIndex).toBe(2);
    expect(s.isPlaying).toBe(false);
  });
});
