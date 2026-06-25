import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { buildArtistDetail, buildAlbum } from '@/test/fakes';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useArtist } from './use-artist';

/**
 * FE-PR3-06 — useArtist hook (REQ-FE-009; DESIGN §5.1).
 * queryKey ['artists','detail',id]; enabled: Boolean(id). ArtistPage composes
 * this + AlbumGrid.
 *
 * The MSW default handler generates names from a seq counter, so this spec
 * overrides it with a KNOWN fixture to assert exact values.
 */
function ArtistHarness({ id }: { id: string }) {
  const { data, isLoading } = useArtist(id);
  if (isLoading || !data) return <div>Loading</div>;
  return (
    <div>
      <span data-testid="artist-name">{data.name}</span>
      <span data-testid="album-count">{data.albums.length}</span>
    </div>
  );
}

const KNOWN = buildArtistDetail({
  id: 'A1',
  name: 'Aretha Franklin',
  albums: [
    { ...buildAlbum(), id: 'alb-1', title: 'I Never Loved a Man' },
    { ...buildAlbum(), id: 'alb-2', title: 'Lady Soul' },
  ],
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useArtist — artist detail + albums (REQ-FE-009)', () => {
  it('fetches the artist detail with embedded albums', async () => {
    server.use(
      http.get(endpoints.artists.detail('A1'), () =>
        HttpResponse.json(KNOWN),
      ),
    );
    render(<ArtistHarness id="A1" />);
    await waitFor(() =>
      expect(screen.getByTestId('artist-name').textContent).toBe(
        'Aretha Franklin',
      ),
    );
    expect(screen.getByTestId('album-count').textContent).toBe('2');
  });

  it('is disabled (no fetch) when the id is empty', async () => {
    render(<ArtistHarness id="" />);
    await waitFor(() =>
      expect(screen.getByText('Loading')).toBeInTheDocument(),
    );
  });
});
