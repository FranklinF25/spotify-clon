import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { usePlayerStore } from '@/store/player.store';
import type { AlbumDetail } from '@/types/api';
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
