import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import type { PlaylistSummary, SavedAlbum } from '@/types/api';
import { RequireAuth } from '@/app/RequireAuth';
import { useAddAlbumToLibrary } from '@/features/library/hooks/use-add-album-to-library';
import { LibraryPage } from './LibraryPage';

/**
 * F6 WORK-PR3-04 — LibraryPage (REQ-FE-016, all 5 scenarios).
 *
 * Two independent caches (['playlists','list'] + ['library','albums'])
 * composed client-side (REQ-L-007 / fork #3). Filter = local useState
 * (D7). The "re-save" scenario drives the REAL save mutation so the
 * invalidation → refetch → re-render path is exercised end-to-end.
 */
const P1: PlaylistSummary = {
  id: 'P1',
  title: 'Road trip',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};
const P2: PlaylistSummary = {
  id: 'P2',
  title: 'Workout',
  createdAt: '2025-01-02T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
};

const A1 = {
  id: 'A1',
  title: 'Alpha',
  releaseYear: 1959,
  coverUrl: null,
  artist: { id: 'ar1', name: 'Miles Davis' },
};
const A2 = {
  id: 'A2',
  title: 'Beta',
  releaseYear: 1957,
  coverUrl: null,
  artist: { id: 'ar2', name: 'John Coltrane' },
};

const SAVED_A1_A2: SavedAlbum[] = [
  { album: A1, addedAt: '2025-01-02T00:00:00.000Z' },
  { album: A2, addedAt: '2025-01-01T00:00:00.000Z' },
];
// After re-saving A2 (upsert resets addedAt) the refetched order flips.
const SAVED_A2_A1: SavedAlbum[] = [
  { album: A2, addedAt: '2025-01-03T00:00:00.000Z' },
  { album: A1, addedAt: '2025-01-02T00:00:00.000Z' },
];

const AUTHED = {
  status: 'authenticated' as const,
  user: { id: 'u', email: 'a@b.co', displayName: 'A' },
  accessToken: 'tok',
  bootRefreshStarted: false,
};

/** Test-only trigger: drives the real save mutation from within the page. */
function SaveTrigger() {
  const save = useAddAlbumToLibrary();
  return (
    <button data-testid="resave" onClick={() => save.mutateAsync({ id: 'A2' })} />
  );
}

function mountPage(initial = '/library', withTrigger = false) {
  useAuthStore.setState(AUTHED);
  return render(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route
          path="/library"
          element={
            <>
              <LibraryPage />
              {withTrigger && <SaveTrigger />}
            </>
          }
        />
        <Route path="/playlists/:id" element={<div data-testid="playlist-detail" />} />
        <Route path="/albums/:id" element={<div data-testid="album-detail" />} />
      </Route>
      {/* /login is a SIBLING outside RequireAuth (nesting it would loop). */}
      <Route path="/login" element={<div data-testid="login-page" />} />
    </Routes>,
    { routeInitialEntries: [initial] },
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('LibraryPage (REQ-FE-016)', () => {
  it('renders both sections from two independent caches', async () => {
    server.use(
      http.get(endpoints.playlists.list, () => HttpResponse.json([P1, P2])),
      http.get(endpoints.library.albums, () =>
        HttpResponse.json(SAVED_A1_A2),
      ),
    );
    mountPage();
    await waitFor(() => expect(screen.getByText('Road trip')).toBeInTheDocument());
    expect(screen.getByText('Workout')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    // Recency order preserved: A1 (newest) before A2.
    const titles = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('aria-label'));
    expect(titles.indexOf('Alpha')).toBeLessThan(titles.indexOf('Beta'));
  });

  it('type filter shows only the selected type and all restores both', async () => {
    server.use(
      http.get(endpoints.playlists.list, () => HttpResponse.json([P1])),
      http.get(endpoints.library.albums, () => HttpResponse.json(SAVED_A1_A2)),
    );
    mountPage();
    await waitFor(() => expect(screen.getByText('Road trip')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^albums$/i }));
    await waitFor(() =>
      expect(screen.queryByText('Road trip')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^all$/i }));
    await waitFor(() => expect(screen.getByText('Road trip')).toBeInTheDocument());
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('re-saving an album moves it to the top after invalidation refetch', async () => {
    let listCount = 0;
    server.use(
      http.get(endpoints.playlists.list, () => HttpResponse.json([P1])),
      http.get(endpoints.library.albums, () => {
        listCount += 1;
        return HttpResponse.json(listCount === 1 ? SAVED_A1_A2 : SAVED_A2_A1);
      }),
      http.post(endpoints.library.album('A2'), () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    mountPage('/library', true);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(screen.getByText('Beta')).toBeInTheDocument();

    screen.getByTestId('resave').click();

    await waitFor(() => {
      const titles = screen
        .getAllByRole('link')
        .map((a) => a.getAttribute('aria-label'));
      expect(titles.indexOf('Beta')).toBeLessThan(titles.indexOf('Alpha'));
    });
    expect(listCount).toBe(2); // initial + invalidated refetch
  });

  it('card clicks navigate to /playlists/P1 and /albums/A1', async () => {
    server.use(
      http.get(endpoints.playlists.list, () => HttpResponse.json([P1])),
      http.get(endpoints.library.albums, () => HttpResponse.json(SAVED_A1_A2)),
    );
    mountPage();
    await waitFor(() => expect(screen.getByText('Road trip')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Road trip'));
    await waitFor(() =>
      expect(screen.getByTestId('playlist-detail')).toBeInTheDocument(),
    );
  });

  it('card click on an album navigates to /albums/A1', async () => {
    server.use(
      http.get(endpoints.playlists.list, () => HttpResponse.json([P1])),
      http.get(endpoints.library.albums, () => HttpResponse.json(SAVED_A1_A2)),
    );
    mountPage();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Alpha'));
    await waitFor(() =>
      expect(screen.getByTestId('album-detail')).toBeInTheDocument(),
    );
  });

  it('renders honest per-section empty states (no fake data)', async () => {
    server.use(
      http.get(endpoints.playlists.list, () => HttpResponse.json([])),
      http.get(endpoints.library.albums, () => HttpResponse.json([])),
    );
    mountPage();
    await waitFor(() =>
      expect(screen.getByText(/no playlists yet/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/no albums saved yet/i)).toBeInTheDocument();
  });

  it('redirects to /login when unauthenticated (RequireAuth)', () => {
    useAuthStore.setState({ status: 'unauthenticated', user: null });
    render(
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/library" element={<LibraryPage />} />
        </Route>
        <Route path="/login" element={<div data-testid="login-page" />} />
      </Routes>,
      { routeInitialEntries: ['/library'] },
    );
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.queryByText(/no albums saved yet/i)).not.toBeInTheDocument();
  });

  it('one source failing does not blank the other section', async () => {
    server.use(
      http.get(endpoints.playlists.list, () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, { status: 500 }),
      ),
      http.get(endpoints.library.albums, () => HttpResponse.json(SAVED_A1_A2)),
    );
    mountPage();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(
      within(screen.getByRole('region', { name: /playlists/i })).getByText(
        /couldn't load playlists/i,
      ),
    ).toBeInTheDocument();
  });
});
