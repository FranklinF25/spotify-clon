import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import type { TrackPrimitive } from '@/types/api';
import { PlaylistTrackList } from './PlaylistTrackList';

/**
 * FE-PR3-04 — PlaylistTrackList organism (REQ-FE-015).
 *
 * Presentational + mutation hooks: receives `tracks` from the page (the page
 * owns the single `usePlaylistTracks(id)` read). Owns per-row remove + reorder
 * (up/down) via `useRemoveTrack` / `useReorderTracks`. Honest states: loading,
 * empty ("no tracks yet"), and 403 on a non-owner mutation surfaces "you are
 * not the owner" — the list is NOT optimistically mutated (R6 lock).
 */
const track = (id: string): TrackPrimitive => ({
  id,
  title: `Song ${id}`,
  durationSeconds: 180,
  trackNumber: 1,
  albumId: 'L1',
});
const T1 = track('T1');
const T2 = track('T2');
const T3 = track('T3');

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('PlaylistTrackList (REQ-FE-015)', () => {
  it('renders the tracks in the given order', () => {
    render(
      <PlaylistTrackList playlistId="P1" tracks={[T1, T2, T3]} isLoading={false} />,
    );
    expect(screen.getByText('Song T1')).toBeInTheDocument();
    expect(screen.getByText('Song T2')).toBeInTheDocument();
    expect(screen.getByText('Song T3')).toBeInTheDocument();
  });

  it('renders an honest "no tracks yet" state when the list is empty', () => {
    render(<PlaylistTrackList playlistId="P1" tracks={[]} isLoading={false} />);
    expect(screen.getByText(/no tracks yet/i)).toBeInTheDocument();
  });

  it('remove fires DELETE :position', async () => {
    const deleteSpy = vi.fn(
      () => new HttpResponse(null, { status: 204 }),
    );
    server.use(
      http.delete(endpoints.playlists.removeTrack('P1', 2), deleteSpy),
    );
    render(
      <PlaylistTrackList playlistId="P1" tracks={[T1, T2, T3]} isLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove Song T2/i }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
  });

  it('reorder-down fires POST reorder {from,to}', async () => {
    let captured: { from: number; to: number } | null = null;
    server.use(
      http.post(endpoints.playlists.reorder('P1'), async ({ request }) => {
        captured = (await request.json()) as { from: number; to: number };
        return HttpResponse.json([], { status: 200 });
      }),
    );
    render(
      <PlaylistTrackList playlistId="P1" tracks={[T1, T2, T3]} isLoading={false} />,
    );
    // Move T1 (position 1) down → { from: 1, to: 2 }.
    fireEvent.click(screen.getByRole('button', { name: /move Song T1 down/i }));
    await waitFor(() => expect(captured).toEqual({ from: 1, to: 2 }));
  });

  it('403 on remove surfaces "you are not the owner" and leaves the list unchanged', async () => {
    server.use(
      http.delete(endpoints.playlists.removeTrack('P1', 2), () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'not yours' } },
          { status: 403 },
        ),
      ),
    );
    render(
      <PlaylistTrackList playlistId="P1" tracks={[T1, T2, T3]} isLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove Song T2/i }));
    await waitFor(() =>
      expect(screen.getByText(/you are not the owner/i)).toBeInTheDocument(),
    );
    // NOT optimistically mutated — all three rows still present.
    expect(screen.getByText('Song T1')).toBeInTheDocument();
    expect(screen.getByText('Song T2')).toBeInTheDocument();
    expect(screen.getByText('Song T3')).toBeInTheDocument();
  });
});
