import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistSummary } from '@/types/api';
import { usePlaylists } from './use-playlists';

/**
 * FE-PR3-02 — usePlaylists query (REQ-FE-014; DESIGN §12.2).
 * queryKey ['playlists','list']; GET /playlists (owner-scoped server-side).
 * Returns PlaylistSummary[].
 */
function Harness() {
  const { data, isLoading } = usePlaylists();
  if (isLoading) return <div>Loading</div>;
  return (
    <div>
      <span data-testid="count">{data?.length ?? 0}</span>
    </div>
  );
}

const PLAYLISTS: PlaylistSummary[] = [
  {
    id: 'P1',
    title: 'Road trip',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'P2',
    title: 'Workout',
    createdAt: '2025-01-02T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
  },
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('usePlaylists — owner-scoped list (REQ-FE-014)', () => {
  it('fetches GET /playlists and returns PlaylistSummary[]', async () => {
    server.use(
      http.get(endpoints.playlists.list, () =>
        HttpResponse.json(PLAYLISTS),
      ),
    );
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('2'),
    );
  });

  it('handles an empty list honestly', async () => {
    server.use(
      http.get(endpoints.playlists.list, () => HttpResponse.json([])),
    );
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('0'),
    );
  });
});
