import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { usePlayerStore } from '@/store/player.store';
import type { AlbumDetail, SavedAlbum } from '@/types/api';
import { AlbumPage } from './AlbumPage';

/**
 * FE-PR3-13 — AlbumPage (REQ-FE-009).
 *
 * Reads :id, calls useAlbum(id), renders the album header + TrackList. "Play
 * album" + each track's play button seed the implicit queue via
 * `playerStore.playFromList(data.tracks, index)`. On ApiError('NOT_FOUND')
 * renders an honest inline not-found state (no crash).
 */
function renderAlbumAt(id: string) {
  return render(
    <Routes>
      <Route path="/albums/:id" element={<AlbumPage />} />
    </Routes>,
    { routeInitialEntries: [`/albums/${id}`] },
  );
}

const ALBUM: AlbumDetail = {
  id: 'L1',
  title: 'Kind of Blue',
  releaseYear: 1959,
  coverUrl: null,
  artistId: 'ar1',
  artist: { id: 'ar1', name: 'Miles Davis' },
  tracks: [
    { id: 't1', title: 'So What', durationSeconds: 565, trackNumber: 1, albumId: 'L1' },
    { id: 't2', title: 'Freddie Freeloader', durationSeconds: 586, trackNumber: 2, albumId: 'L1' },
    { id: 't3', title: 'Blue in Green', durationSeconds: 335, trackNumber: 3, albumId: 'L1' },
  ],
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
// Default library mock: the page also reads ['library','albums']; each
// REQ-FE-017 test overrides with its own sequence via server.use.
beforeEach(() => {
  server.use(
    http.get(endpoints.library.albums, () => HttpResponse.json([])),
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('AlbumPage — track list + queue seeding (REQ-FE-009)', () => {
  it('embeds the album header + one TrackRow per track', async () => {
    server.use(
      http.get(endpoints.albums.detail('L1'), () => HttpResponse.json(ALBUM)),
    );
    renderAlbumAt('L1');
    await waitFor(() =>
      expect(screen.getByText('Kind of Blue')).toBeInTheDocument(),
    );
    expect(screen.getByText('Miles Davis')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('seeds the queue from index 0 when "Play album" is clicked', async () => {
    server.use(
      http.get(endpoints.albums.detail('L1'), () => HttpResponse.json(ALBUM)),
    );
    renderAlbumAt('L1');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /play album/i })).toBeInTheDocument(),
    );
    screen.getByRole('button', { name: /play album/i }).click();
    const s = usePlayerStore.getState();
    expect(s.queue).toEqual(ALBUM.tracks);
    expect(s.currentIndex).toBe(0);
    expect(s.isPlaying).toBe(true);
  });

  it('seeds the queue at the picked index when a track row play is clicked', async () => {
    server.use(
      http.get(endpoints.albums.detail('L1'), () => HttpResponse.json(ALBUM)),
    );
    renderAlbumAt('L1');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /play Freddie Freeloader/i })).toBeInTheDocument(),
    );
    screen.getByRole('button', { name: /play Freddie Freeloader/i }).click();
    const s = usePlayerStore.getState();
    expect(s.queue).toEqual(ALBUM.tracks);
    expect(s.currentIndex).toBe(1); // 2nd track
  });

  it('renders an honest not-found state on NOT_FOUND (no crash)', async () => {
    server.use(
      http.get(
        endpoints.albums.detail('nope'),
        () =>
          HttpResponse.json(
            { error: { code: 'NOT_FOUND', message: 'gone' } },
            { status: 404 },
          ),
      ),
    );
    renderAlbumAt('nope');
    await waitFor(() =>
      expect(screen.getByText(/couldn't find that album/i)).toBeInTheDocument(),
    );
    // No track rows rendered.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

/**
 * F6 WORK-PR3-05 — AlbumPage save/remove affordance (REQ-FE-017, all 4
 * scenarios). Saved state is DERIVED from the single ['library','albums']
 * cache (D-fe-3 — no second query, no local mirror). 422 surfaces ON the
 * control via local actionError state (D-fe-1 — FORM_OWNED_CODES is NOT
 * extended; the toast redundancy is accepted).
 */
const LIB_A1: SavedAlbum[] = [
  {
    album: {
      id: 'L1',
      title: 'Kind of Blue',
      releaseYear: 1959,
      coverUrl: null,
      artist: { id: 'ar1', name: 'Miles Davis' },
    },
    addedAt: '2025-01-02T00:00:00.000Z',
  },
];

function mockLibrary(sequence: SavedAlbum[][]) {
  let i = 0;
  return server.use(
    http.get(endpoints.library.albums, () => {
      const body = sequence[Math.min(i, sequence.length - 1)]!;
      i += 1;
      return HttpResponse.json(body);
    }),
  );
}

describe('AlbumPage — save/remove affordance (REQ-FE-017)', () => {
  it('saving flips the affordance and refreshes the library cache', async () => {
    server.use(
      http.get(endpoints.albums.detail('L1'), () => HttpResponse.json(ALBUM)),
    );
    mockLibrary([[], LIB_A1]);
    const postSpy = () => new HttpResponse(null, { status: 204 });
    server.use(http.post(endpoints.library.album('L1'), postSpy));

    renderAlbumAt('L1');
    const save = await screen.findByRole('button', { name: /save to library/i });
    expect(save).toHaveAttribute('aria-pressed', 'false');

    save.click();

    await waitFor(() => {
      const remove = screen.getByRole('button', {
        name: /remove from library/i,
      });
      expect(remove).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('removing flips the affordance back', async () => {
    server.use(
      http.get(endpoints.albums.detail('L1'), () => HttpResponse.json(ALBUM)),
    );
    mockLibrary([LIB_A1, []]);
    server.use(
      http.delete(endpoints.library.album('L1'), () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );

    renderAlbumAt('L1');
    const remove = await screen.findByRole('button', {
      name: /remove from library/i,
    });
    expect(remove).toHaveAttribute('aria-pressed', 'true');

    remove.click();

    await waitFor(() => {
      const save = screen.getByRole('button', { name: /save to library/i });
      expect(save).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('saved state is derived from the library list cache (no duplicate state)', async () => {
    server.use(
      http.get(endpoints.albums.detail('L1'), () => HttpResponse.json(ALBUM)),
    );
    mockLibrary([LIB_A1]);
    renderAlbumAt('L1');
    const remove = await screen.findByRole('button', {
      name: /remove from library/i,
    });
    expect(remove).toHaveAttribute('aria-pressed', 'true');
  });

  it('422 on save surfaces an honest error and does NOT flip the state', async () => {
    server.use(
      http.get(endpoints.albums.detail('L1'), () => HttpResponse.json(ALBUM)),
    );
    mockLibrary([[]]);
    server.use(
      http.post(endpoints.library.album('L1'), () =>
        HttpResponse.json(
          {
            error: {
              code: 'UNPROCESSABLE_ENTITY',
              message: "album 'L1' cannot be resolved",
            },
          },
          { status: 422 },
        ),
      ),
    );

    renderAlbumAt('L1');
    const save = await screen.findByRole('button', { name: /save to library/i });
    save.click();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /cannot be resolved/i,
      ),
    );
    // The saved state did NOT flip.
    expect(
      screen.getByRole('button', { name: /save to library/i }),
    ).toHaveAttribute('aria-pressed', 'false');
  });
});
