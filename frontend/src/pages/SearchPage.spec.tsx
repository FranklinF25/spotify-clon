import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { useAuthStore } from '@/store/auth.store';
import { buildAlbum, buildArtist } from '@/test/fakes';
import { SearchPage } from './SearchPage';

/**
 * FE-PR4-06 — SearchPage (REQ-FE-010). Replaces the PR-3 placeholder.
 *
 * Reads `?q=` from the URL (shareable + back-button-friendly), renders the
 * SearchBar pre-filled, calls useSearch(q), and renders THREE grouped
 * sections (artists, albums, tracks). Three states:
 *  - empty `q`        → intro state, NO backend request.
 *  - `q` with matches → three sections, each listing its matches.
 *  - `q` no matches   → three EMPTY sections render WITHOUT error.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('SearchPage — empty query does not hit the backend (REQ-FE-010)', () => {
  it('renders an intro state when no q is present + issues NO /search', async () => {
    // Mark the handler so any unexpected call throws the test.
    server.use(
      http.get('/api/v1/search', () => {
        throw new Error('empty query MUST NOT hit /search');
      }),
    );
    useAuthStore.setState({ accessToken: 'T' });

    render(<SearchPage />, { routeInitialEntries: ['/search'] });

    // The intro state is rendered; no results section is populated.
    expect(screen.getByRole('heading', { name: /search/i })).toBeInTheDocument();
    // No artist/album/track result items are rendered (sections absent or
    // empty intro state shown).
    expect(screen.queryAllByRole('link', { name: /album/i })).toHaveLength(0);

    // Let any pending microtasks settle — the assertion stays.
    await waitFor(() =>
      expect(screen.queryAllByRole('link', { name: /album/i })).toHaveLength(0),
    );
  });
});

describe('SearchPage — query returns grouped results (REQ-FE-010)', () => {
  it('renders three grouped sections each listing its matches', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    const artist = buildArtist({ name: 'Found Artist' });
    const album = buildAlbum({ title: 'Found Album' });
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          artists: [artist],
          albums: [album],
          tracks: [
            {
              id: 't1',
              title: 'Found Track',
              durationSeconds: 100,
              albumId: album.id,
            },
          ],
        }),
      ),
    );

    render(<SearchPage />, {
      routeInitialEntries: ['/search?q=foo'],
    });

    // Three sections, each with at least one item.
    await waitFor(() =>
      expect(screen.getByText('Found Artist')).toBeInTheDocument(),
    );
    expect(screen.getByText('Found Album')).toBeInTheDocument();
    expect(screen.getByText('Found Track')).toBeInTheDocument();

    // Each section header is present.
    expect(screen.getByRole('heading', { name: /^artists$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^albums$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^tracks$/i })).toBeInTheDocument();
  });
});

describe('SearchPage — no matches renders three empty groups (REQ-FE-010)', () => {
  it('renders the three empty grouped sections without error', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({ artists: [], albums: [], tracks: [] }),
      ),
    );

    render(<SearchPage />, {
      routeInitialEntries: ['/search?q=zzz'],
    });

    // The three section headers are present (the groups render empty).
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^artists$/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: /^albums$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^tracks$/i })).toBeInTheDocument();

    // No items in any group — but no error either.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
