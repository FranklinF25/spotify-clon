import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { ArtistDetail } from '@/types/api';
import { ArtistPage } from './ArtistPage';

/**
 * FE-PR3-14 — ArtistPage (REQ-FE-009). Reads :id, calls useArtist(id), renders
 * the artist header + AlbumGrid from the EMBEDDED albums (no second /albums
 * hop). NOT_FOUND renders the inline NotFoundPage (mirrors AlbumPage).
 */
function renderArtistAt(id: string) {
  return render(
    <Routes>
      <Route path="/artists/:id" element={<ArtistPage />} />
    </Routes>,
    { routeInitialEntries: [`/artists/${id}`] },
  );
}

const ARTIST: ArtistDetail = {
  id: 'A1',
  name: 'Aretha Franklin',
  bio: 'Queen of Soul',
  imageUrl: null,
  albums: [
    {
      id: 'alb-1',
      title: 'I Never Loved a Man',
      releaseYear: 1967,
      coverUrl: null,
      artist: { id: 'A1', name: 'Aretha Franklin' },
    },
    {
      id: 'alb-2',
      title: 'Lady Soul',
      releaseYear: 1968,
      coverUrl: null,
      artist: { id: 'A1', name: 'Aretha Franklin' },
    },
  ],
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('ArtistPage — embedded albums (REQ-FE-009)', () => {
  it('renders the artist header + one card per embedded album', async () => {
    server.use(
      http.get(endpoints.artists.detail('A1'), () => HttpResponse.json(ARTIST)),
    );
    renderArtistAt('A1');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Aretha Franklin' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('Queen of Soul')).toBeInTheDocument();
    expect(screen.getByText('I Never Loved a Man')).toBeInTheDocument();
    expect(screen.getByText('Lady Soul')).toBeInTheDocument();
    // 2 album cards → 2 links into /albums/:id.
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('renders an honest not-found state on NOT_FOUND (no crash)', async () => {
    server.use(
      http.get(
        endpoints.artists.detail('ghost'),
        () =>
          HttpResponse.json(
            { error: { code: 'NOT_FOUND', message: 'gone' } },
            { status: 404 },
          ),
      ),
    );
    renderArtistAt('ghost');
    await waitFor(() =>
      expect(screen.getByText(/couldn't find that artist/i)).toBeInTheDocument(),
    );
    // No album content rendered.
    expect(screen.queryByText('I Never Loved a Man')).toBeNull();
    expect(screen.queryByText('Lady Soul')).toBeNull();
  });
});
