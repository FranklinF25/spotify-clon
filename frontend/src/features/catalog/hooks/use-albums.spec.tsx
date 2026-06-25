import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import type { PaginatedResult, AlbumSummary } from '@/types/api';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { buildAlbum, paginate } from '@/test/fakes';
import { useAlbums } from './use-albums';

/**
 * FE-PR3-06 — useAlbums hook (REQ-FE-009, REQ-FE-006; DESIGN §5.1).
 * TanStack Query owns the server cache (NOT Zustand). queryKey
 * ['albums','list',{page,pageSize}]; placeholderData: keepPreviousData so
 * pagination does not flash empty while the next page loads.
 *
 * The hook renders through a tiny harness component so RTL + a fresh
 * QueryClient (render.tsx) drive the cache + lifecycle.
 */
function AlbumsHarness({ page, pageSize }: { page: number; pageSize: number }) {
  const { data, isLoading } = useAlbums({ page, pageSize });
  if (isLoading) return <div>Loading</div>;
  return (
    <div>
      <span data-testid="page-count">
        {data?.items.map((a) => a.title).join(',')}
      </span>
    </div>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useAlbums — server cache ownership (REQ-FE-006)', () => {
  it('caches the result under the documented query key', async () => {
    const { queryClient } = render(<AlbumsHarness page={1} pageSize={20} />);
    await waitFor(() =>
      expect(screen.getByTestId('page-count').textContent).not.toBe(''),
    );
    const cached = queryClient.getQueryData<PaginatedResult<AlbumSummary>>([
      'albums',
      'list',
      { page: 1, pageSize: 20 },
    ]);
    expect(cached).toBeDefined();
    expect(cached?.items.length).toBeGreaterThan(0);
    // page + pageSize are echoed in the PaginatedResult envelope.
    expect(cached?.page).toBe(1);
    expect(cached?.pageSize).toBe(20);
  });
});

describe('useAlbums — keepPreviousData avoids an empty flash (REQ-FE-009)', () => {
  it('keeps page-1 items visible while page-2 is still loading', async () => {
    // Distinct per-page data so we can tell which page is rendered.
    const page1: AlbumSummary[] = [
      { ...buildAlbum(), id: 'p1-a', title: 'Page One Album' },
    ];
    const page2: AlbumSummary[] = [
      { ...buildAlbum(), id: 'p2-a', title: 'Page Two Album' },
    ];

    server.use(
      http.get(endpoints.artists.list(), () => HttpResponse.json(paginate([]))),
    );
    // Override the albums list handler: page 1 immediate, page 2 delayed.
    server.use(
      http.get('*', async ({ request }) => {
        const url = new URL(request.url);
        if (!url.pathname.endsWith('/albums')) return HttpResponse.json({});
        const page = Number(url.searchParams.get('page') ?? 1);
        if (page === 1) return HttpResponse.json(paginate(page1, 1, 10));
        await delay(50);
        return HttpResponse.json(paginate(page2, 2, 10));
      }),
    );

    const { rerender } = render(<AlbumsHarness page={1} pageSize={10} />);
    await waitFor(() =>
      expect(screen.getByTestId('page-count').textContent).toContain(
        'Page One Album',
      ),
    );

    // Switch to page 2 — its response is delayed. keepPreviousData should keep
    // page-1 items visible (NO empty flash) while page 2 loads.
    rerender(<AlbumsHarness page={2} pageSize={10} />);
    // Immediately after switching, page-1 data is still on screen.
    expect(screen.getByTestId('page-count').textContent).toContain(
      'Page One Album',
    );

    // Eventually page-2 lands.
    await waitFor(() =>
      expect(screen.getByTestId('page-count').textContent).toContain(
        'Page Two Album',
      ),
    );
  });
});
