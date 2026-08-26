import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import { usePlayerStore } from '@/store/player.store';
import { buildAlbum, buildAlbumDetail, buildArtist } from '@/test/fakes';
import type { AlbumDetail, TrackSummary } from '@/types/api';
import { SearchPage } from './SearchPage';

/**
 * FE-PR4-06 — SearchPage (REQ-FE-010). Live-search parity with the
 * AddTrackPicker feel + actionable results.
 *
 * Architecture under test: the page owns the 300ms cancellable debounce
 * (term → setSearchParams({q}, {replace:true}) → useSearch(q)); the SearchBar
 * molecule stays presentational (its own spec covers submit-only usage).
 * `?q=` is seeded on mount and remains the shareable committed query —
 * written with REPLACE so typing never spams history.
 *
 * Groups render through the app-wide organisms: AlbumGrid/AlbumCard (album
 * play = fetchQuery(albumQueryOptions) → playFromList(detail.tracks, 0)) and
 * TrackList (row play = playFromList(results, index)). TrackSummary carries
 * NO trackNumber, so the page adapts results with position-in-list numbers.
 *
 * Fake timers drive the debounce deterministically (AddTrackPicker.spec
 * pattern); the playable-results scenarios use real timers + MSW, mirroring
 * AlbumPage.spec's queue-seeding assertions.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Exposes the MemoryRouter location so specs can assert the committed ?q=. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.search}</span>;
}

const searchInput = () => screen.getByLabelText('Search');

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

    // Three sections, each with at least one item. The album renders through
    // AlbumCard and the track through TrackRow (playable organisms) — the
    // text assertions survive the swap because both render the title.
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

describe('SearchPage — live debounced search (REQ-FE-010)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the Searching spinner while typing and commits q only after 300ms', () => {
    useAuthStore.setState({ accessToken: 'T' });
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({ artists: [], albums: [], tracks: [] }),
      ),
    );

    render(
      <>
        <SearchPage />
        <LocationProbe />
      </>,
      { routeInitialEntries: ['/search'] },
    );
    fireEvent.change(searchInput(), { target: { value: 'found' } });

    // 1ms short of the window: q NOT committed (URL still clean) and the
    // typing Spinner is up.
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.getByTestId('location')).toHaveTextContent('');
    expect(screen.getByLabelText('Searching')).toBeInTheDocument();

    // Window elapsed: the debounced q lands in the URL (replace, not push —
    // asserted separately below). No further keystroke ever re-fires early.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('location')).toHaveTextContent('?q=found');
  });

  it('retimes when the query changes mid-debounce (only the final q commits)', () => {
    useAuthStore.setState({ accessToken: 'T' });
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({ artists: [], albums: [], tracks: [] }),
      ),
    );

    render(
      <>
        <SearchPage />
        <LocationProbe />
      </>,
      { routeInitialEntries: ['/search'] },
    );
    fireEvent.change(searchInput(), { target: { value: 'fou' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.change(searchInput(), { target: { value: 'found' } });

    // 200 + 299 < 300ms since the LAST keystroke — nothing committed yet.
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.getByTestId('location')).toHaveTextContent('');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('location')).toHaveTextContent('?q=found');
  });

  it('commits the debounced q via REPLACE — back cannot leave the committed q', () => {
    useAuthStore.setState({ accessToken: 'T' });
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({ artists: [], albums: [], tracks: [] }),
      ),
    );

    // Expose the router's navigate so the spec can drive a real history
    // transition (MemoryRouter owns its history internally).
    let goBack: ((delta: number) => void) | null = null;
    function NavigateProbe() {
      goBack = useNavigate();
      return null;
    }

    render(
      <>
        <SearchPage />
        <LocationProbe />
        <NavigateProbe />
      </>,
      { routeInitialEntries: ['/search'] },
    );

    fireEvent.change(searchInput(), { target: { value: 'foo' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('location')).toHaveTextContent('?q=foo');

    // The page started on the SINGLE '/search' history entry and every
    // commit is a REPLACE — history never grew a second '/search' entry, so
    // goBack is a clamped no-op and the committed q stays. A push-based
    // implementation would pop back to the query-less '/search'.
    act(() => {
      goBack?.(-1);
    });
    expect(screen.getByTestId('location')).toHaveTextContent('?q=foo');
  });

  it('Enter commits immediately without waiting for the debounce window', () => {
    useAuthStore.setState({ accessToken: 'T' });
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({ artists: [], albums: [], tracks: [] }),
      ),
    );

    render(
      <>
        <SearchPage />
        <LocationProbe />
      </>,
      { routeInitialEntries: ['/search'] },
    );
    fireEvent.change(searchInput(), { target: { value: 'bar' } });
    // Submit WITHOUT advancing the timers — the flush must not need them.
    fireEvent.submit(searchInput().closest('form')!);
    expect(screen.getByTestId('location')).toHaveTextContent('?q=bar');
  });

  it('updates the results after the debounce settles (typing → live results)', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          artists: [buildArtist({ name: 'Found Artist' })],
          albums: [],
          tracks: [],
        }),
      ),
    );

    render(
      <>
        <SearchPage />
        <LocationProbe />
      </>,
      { routeInitialEntries: ['/search'] },
    );
    fireEvent.change(searchInput(), { target: { value: 'found' } });

    // The debounce window is driven under FAKE timers (the deterministic
    // part): q commits exactly at 300ms, never before.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('location')).toHaveTextContent('?q=found');

    // The network leg needs REAL timers — the MSW interceptor's I/O does not
    // advance under faked setImmediate, so the flush waits on the true event
    // loop once the commit is proven.
    vi.useRealTimers();
    await waitFor(() =>
      expect(screen.getByText('Found Artist')).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText('Searching')).not.toBeInTheDocument();
  });
});

describe('SearchPage — playable results (implicit queue, REQ-FE-011)', () => {
  const TRACKS: TrackSummary[] = [
    { id: 't1', title: 'First Hit', durationSeconds: 100, albumId: 'a1' },
    { id: 't2', title: 'Second Hit', durationSeconds: 200, albumId: 'a1' },
  ];

  it('seeds the queue at the picked index when a track row play is clicked', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({ artists: [], albums: [], tracks: TRACKS }),
      ),
    );

    render(<SearchPage />, { routeInitialEntries: ['/search?q=hit'] });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Play Second Hit' }),
      ).toBeInTheDocument(),
    );

    screen.getByRole('button', { name: 'Play Second Hit' }).click();
    const s = usePlayerStore.getState();
    // Queue = the RESULTS list; TrackSummary has no trackNumber, so rows are
    // adapted with their position in the results (page-level adapter).
    expect(s.queue).toEqual([
      { ...TRACKS[0], trackNumber: 1 },
      { ...TRACKS[1], trackNumber: 2 },
    ]);
    expect(s.currentIndex).toBe(1); // the picked row
    expect(s.isPlaying).toBe(true);
  });

  it('fetches the album detail then seeds the queue when an album play is clicked', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    // KNOWN detail fixture (the default MSW handler generates from a seq
    // counter — the use-album.spec gotcha): exact queue equality needs it.
    const DETAIL: AlbumDetail = buildAlbumDetail({
      id: 'L1',
      title: 'Kind of Blue',
      tracks: [
        { id: 't1', title: 'So What', durationSeconds: 565, trackNumber: 1, albumId: 'L1' },
        { id: 't2', title: 'Freddie Freeloader', durationSeconds: 586, trackNumber: 2, albumId: 'L1' },
      ],
    });
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          artists: [],
          albums: [buildAlbum({ id: 'L1', title: 'Kind of Blue' })],
          tracks: [],
        }),
      ),
      http.get(endpoints.albums.detail('L1'), () =>
        HttpResponse.json(DETAIL),
      ),
    );

    render(<SearchPage />, { routeInitialEntries: ['/search?q=blue'] });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Play Kind of Blue' }),
      ).toBeInTheDocument(),
    );

    // The card play is async (fetchQuery shares the ['albums','detail',id]
    // cache with useAlbum) — wait for the queue to be seeded from index 0.
    screen.getByRole('button', { name: 'Play Kind of Blue' }).click();
    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.queue).toEqual(DETAIL.tracks);
      expect(s.currentIndex).toBe(0);
      expect(s.isPlaying).toBe(true);
    });
  });
});
