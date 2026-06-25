import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { PaginatedResult, AlbumSummary } from '@/types/api';
import { HomePage } from './HomePage';

/**
 * FE-PR3-12 — HomePage (REQ-FE-009). Featured = first page of /albums.
 * Calls useAlbums({page:1, pageSize:20}) + renders AlbumGrid. Loading = Spinner;
 * error = QueryCache.onError toast (wired in PR-2) + an inline retry affordance.
 *
 * The MSW default /albums handler returns 3 summaries; we override with KNOWN
 * titles so card-count + cache-key assertions are exact.
 */
const FEATURED: AlbumSummary[] = [
  {
    id: 'a1',
    title: 'Kind of Blue',
    releaseYear: 1959,
    coverUrl: null,
    artist: { id: 'ar1', name: 'Miles Davis' },
  },
  {
    id: 'a2',
    title: 'A Love Supreme',
    releaseYear: 1965,
    coverUrl: null,
    artist: { id: 'ar2', name: 'Coltrane' },
  },
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('HomePage — featured album grid (REQ-FE-009)', () => {
  it('renders a Spinner while loading, then one card per featured album', async () => {
    server.use(
      http.get(endpoints.artists.list(), () => HttpResponse.json([])),
      http.get('*', async ({ request }) => {
        const url = new URL(request.url);
        if (!url.pathname.endsWith('/albums')) return HttpResponse.json({});
        const page = Number(url.searchParams.get('page') ?? 1);
        return HttpResponse.json({
          items: page === 1 ? FEATURED : [],
          total: FEATURED.length,
          page,
          pageSize: 20,
        } satisfies PaginatedResult<AlbumSummary>);
      }),
    );

    render(<HomePage />);

    // Loading state first.
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();

    // Then the grid resolves.
    await waitFor(() =>
      expect(screen.getByText('Kind of Blue')).toBeInTheDocument(),
    );
    expect(screen.getByText('A Love Supreme')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('caches the featured list under the documented query key', async () => {
    server.use(
      http.get('*', async ({ request }) => {
        const url = new URL(request.url);
        if (!url.pathname.endsWith('/albums')) return HttpResponse.json({});
        return HttpResponse.json({
          items: FEATURED,
          total: FEATURED.length,
          page: 1,
          pageSize: 20,
        });
      }),
    );

    const { queryClient } = render(<HomePage />);
    await waitFor(() =>
      expect(screen.getByText('Kind of Blue')).toBeInTheDocument(),
    );
    const cached = queryClient.getQueryData<PaginatedResult<AlbumSummary>>([
      'albums',
      'list',
      { page: 1, pageSize: 20 },
    ]);
    expect(cached?.items).toEqual(FEATURED);
  });

  it('renders an inline retry affordance when the featured fetch fails', async () => {
    let calls = 0;
    server.use(
      http.get('*', async ({ request }) => {
        const url = new URL(request.url);
        if (!url.pathname.endsWith('/albums')) return HttpResponse.json({});
        calls += 1;
        return HttpResponse.json(
          { error: { code: 'UNKNOWN', message: 'down' } },
          { status: 500 },
        );
      }),
    );

    render(<HomePage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument(),
    );
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
