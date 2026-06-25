import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { SearchResult } from '@/types/api';
import { buildArtist, buildAlbum } from '@/test/fakes';
import { useSearch } from './use-search';

/**
 * FE-PR4-05 — useSearch hook (REQ-FE-010, DESIGN §5.1).
 *
 * TanStack Query owns the server cache for the search endpoint. The hook
 * MUST be `enabled` ONLY when `q.length > 0` so an empty query does NOT
 * hit the backend. Query key is the STABLE array `['search', q, type]`.
 * `type` is the singular 'artist' | 'album' | 'track' | undefined (JD fix #1
 * — backend dto/search.dto.ts uses the singular enum, NOT a plural).
 */
function SearchHarness({
  q,
  type,
}: {
  q: string;
  type?: 'artist' | 'album' | 'track';
}) {
  const { data, isLoading } = useSearch(q, type);
  return (
    <div>
      <span data-testid="state">
        {isLoading ? 'loading' : data ? 'has-data' : 'idle'}
      </span>
      <span data-testid="artists">
        {data?.artists.map((a) => a.name).join(',')}
      </span>
    </div>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useSearch — empty query does not hit the backend (REQ-FE-010)', () => {
  it('returns idle + issues NO /search request when q is empty', async () => {
    // Mark the handler so any unexpected call throws the test.
    server.use(
      http.get('/api/v1/search', () => {
        throw new Error('empty query MUST NOT hit /search');
      }),
    );

    render(<SearchHarness q="" />);
    expect(screen.getByTestId('state').textContent).toBe('idle');

    // Give any pending microtasks a chance to fire — the assertion stays
    // idle (no request, no error).
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('idle'),
    );
  });
});

describe('useSearch — query returns grouped results (REQ-FE-010)', () => {
  it('queries /search?q=foo + caches under ["search","foo",undefined]', async () => {
    const artist = buildArtist();
    const fixture: SearchResult = {
      artists: [artist],
      albums: [buildAlbum()],
      tracks: [
        {
          id: 't1',
          title: 'Found Track',
          durationSeconds: 100,
          albumId: 'a1',
        },
      ],
    };
    server.use(
      http.get('/api/v1/search', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('q')).toBe('foo');
        return HttpResponse.json(fixture);
      }),
    );

    const { queryClient } = render(<SearchHarness q="foo" />);
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('has-data'),
    );
    expect(screen.getByTestId('artists').textContent).toBe(artist.name);

    const cached = queryClient.getQueryData<SearchResult>([
      'search',
      'foo',
      undefined,
    ]);
    expect(cached).toBeDefined();
    expect(cached?.artists).toHaveLength(1);
  });

  it('passes type=artist as a singular query param when provided', async () => {
    let seenType: string | null = null;
    server.use(
      http.get('/api/v1/search', ({ request }) => {
        const url = new URL(request.url);
        seenType = url.searchParams.get('type');
        return HttpResponse.json({
          artists: [buildArtist()],
          albums: [],
          tracks: [],
        });
      }),
    );

    render(<SearchHarness q="foo" type="artist" />);
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('has-data'),
    );
    // JD fix #1: type is SINGULAR ('artist'), NOT a plural.
    expect(seenType).toBe('artist');

    // Also exercise the endpoints.search helper directly for the same
    // guarantee (the hook calls httpClient.get(endpoints.search(q, type))).
    expect(endpoints.search('foo', 'artist')).toContain('type=artist');
  });
});
