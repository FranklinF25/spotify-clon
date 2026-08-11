import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { AddTrackForm } from './AddTrackForm';

/**
 * FE-PR3-04 — AddTrackForm molecule (REQ-FE-015).
 *
 * Track picker (simple UUID input for the demo) → `useAddTrack` mutation. The
 * form validates a non-empty trackId PRE-request (honest client gate), then
 * POSTs `{ trackId }`. Honest error surfacing:
 *  - 422 UNPROCESSABLE_ENTITY (unknown trackId) → "track not found"
 *  - 403 FORBIDDEN (non-owner) → "you are not the owner"
 *  - 201 success → the form resets; the parent's tracks-query invalidation
 *    (fired inside `useAddTrack.onSuccess`) appends the track on refetch.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('AddTrackForm (REQ-FE-015)', () => {
  it('blocks an empty trackId BEFORE any POST is issued', async () => {
    const spy = vi.fn(() => HttpResponse.json({}, { status: 201 }));
    server.use(http.post(endpoints.playlists.addTrack('P1'), spy));
    render(<AddTrackForm playlistId="P1" />);
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    await waitFor(() =>
      expect(screen.getByText(/track id is required/i)).toBeInTheDocument(),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('on 201 it POSTs { trackId } and resets the input', async () => {
    const spy = vi.fn(() =>
      HttpResponse.json(
        { position: 1, trackId: 'T9', addedAt: '2025-01-01T00:00:00.000Z' },
        { status: 201 },
      ),
    );
    server.use(http.post(endpoints.playlists.addTrack('P1'), spy));
    render(<AddTrackForm playlistId="P1" />);
    fireEvent.change(screen.getByLabelText(/track id/i), {
      target: { value: 'T9' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // input reset after success
    expect(screen.getByLabelText(/track id/i)).toHaveValue('');
  });

  it('surfaces a 422 (unknown trackId) honestly', async () => {
    server.use(
      http.post(endpoints.playlists.addTrack('P1'), () =>
        HttpResponse.json(
          { error: { code: 'UNPROCESSABLE_ENTITY', message: 'unknown track' } },
          { status: 422 },
        ),
      ),
    );
    render(<AddTrackForm playlistId="P1" />);
    fireEvent.change(screen.getByLabelText(/track id/i), {
      target: { value: 'T-NOPE' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    await waitFor(() =>
      expect(screen.getByText(/track not found/i)).toBeInTheDocument(),
    );
  });

  it('surfaces a 403 (non-owner) honestly', async () => {
    server.use(
      http.post(endpoints.playlists.addTrack('P1'), () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'not yours' } },
          { status: 403 },
        ),
      ),
    );
    render(<AddTrackForm playlistId="P1" />);
    fireEvent.change(screen.getByLabelText(/track id/i), {
      target: { value: 'T9' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    await waitFor(() =>
      expect(screen.getByText(/you are not the owner/i)).toBeInTheDocument(),
    );
  });
});
