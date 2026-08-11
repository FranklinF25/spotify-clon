import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import type { PlaylistPrimitive, PlaylistSummary } from '@/types/api';
import { RequireAuth } from '@/app/RequireAuth';
import { PlaylistsPage } from './PlaylistsPage';

/**
 * FE-PR3-03 — PlaylistsPage (REQ-FE-014).
 *
 * Every REQ-FE-014 scenario is covered via a declarative MemoryRouter tree:
 *  - cards render from cache (['playlists','list'])
 *  - create invalidates + navigates to /playlists/:id
 *  - empty state ("no playlists yet" + create CTA)
 *  - click card navigates to /playlists/:id
 *  - invalid title blocked PRE-request (zod mirror 1–100 chars)
 *  - unauthenticated redirected to /login (RequireAuth)
 */
const P1: PlaylistSummary = {
  id: 'P1',
  title: 'Road trip',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};
const P2: PlaylistSummary = {
  id: 'P2',
  title: 'Workout',
  createdAt: '2025-01-02T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
};

const AUTHED = {
  status: 'authenticated' as const,
  user: { id: 'u', email: 'a@b.co', displayName: 'A' },
  accessToken: 'tok',
  bootRefreshStarted: false,
};

function mountPage(initial = '/playlists') {
  useAuthStore.setState(AUTHED);
  return render(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/playlists" element={<PlaylistsPage />} />
        <Route path="/playlists/:id" element={<div data-testid="detail-page" />} />
      </Route>
      {/* /login is a SIBLING outside RequireAuth — nesting it inside would
          loop (RequireAuth redirects to /login → /login matches inside
          RequireAuth → redirects again → infinite render). */}
      <Route path="/login" element={<div data-testid="login-page" />} />
    </Routes>,
    { routeInitialEntries: [initial] },
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('PlaylistsPage (REQ-FE-014)', () => {
  it('renders one card per playlist sourced from the list cache', async () => {
    server.use(
      http.get(endpoints.playlists.list, () => HttpResponse.json([P1, P2])),
    );
    mountPage();
    await waitFor(() => expect(screen.getByText('Road trip')).toBeInTheDocument());
    expect(screen.getByText('Workout')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('renders an honest empty state with the create CTA (no fake data)', async () => {
    server.use(
      http.get(endpoints.playlists.list, () => HttpResponse.json([])),
    );
    mountPage();
    await waitFor(() =>
      expect(screen.getByText(/no playlists yet/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /new playlist/i }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('clicking a card navigates to /playlists/:id', async () => {
    server.use(
      http.get(endpoints.playlists.list, () => HttpResponse.json([P1])),
    );
    mountPage();
    await waitFor(() => expect(screen.getByText('Road trip')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Road trip'));
    await waitFor(() =>
      expect(screen.getByTestId('detail-page')).toBeInTheDocument(),
    );
  });

  it('creating a playlist invalidates the list and navigates to detail', async () => {
    let listCount = 0;
    server.use(
      http.get(endpoints.playlists.list, () => {
        listCount += 1;
        return HttpResponse.json(listCount === 1 ? [] : [P1]);
      }),
    );
    const CREATED: PlaylistPrimitive = {
      id: 'P1',
      userId: 'u',
      title: 'Road trip',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    const postSpy = vi.fn(() => HttpResponse.json(CREATED, { status: 201 }));
    server.use(http.post(endpoints.playlists.create, postSpy));

    mountPage();
    await waitFor(() =>
      expect(screen.getByText(/no playlists yet/i)).toBeInTheDocument(),
    );

    // Open the inline form + submit a valid title.
    fireEvent.click(screen.getByRole('button', { name: /new playlist/i }));
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Road trip' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    // Navigated to /playlists/P1 (detail marker renders).
    await waitFor(() =>
      expect(screen.getByTestId('detail-page')).toBeInTheDocument(),
    );
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(listCount).toBe(2); // invalidated → refetch
  });

  it('rejects an empty title BEFORE any POST is issued (zod mirror)', async () => {
    server.use(http.get(endpoints.playlists.list, () => HttpResponse.json([])));
    const postSpy = vi.fn(() => HttpResponse.json({}, { status: 201 }));
    server.use(http.post(endpoints.playlists.create, postSpy));

    mountPage();
    await waitFor(() =>
      expect(screen.getByText(/no playlists yet/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /new playlist/i }));
    // Submit WITHOUT typing a title (empty).
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() =>
      expect(screen.getByText(/title is required/i)).toBeInTheDocument(),
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects a 101-character title BEFORE any POST is issued (zod mirror)', async () => {
    server.use(http.get(endpoints.playlists.list, () => HttpResponse.json([])));
    const postSpy = vi.fn(() => HttpResponse.json({}, { status: 201 }));
    server.use(http.post(endpoints.playlists.create, postSpy));

    mountPage();
    await waitFor(() =>
      expect(screen.getByText(/no playlists yet/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /new playlist/i }));
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'x'.repeat(101) },
    });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() =>
      expect(screen.getByText(/at most 100/i)).toBeInTheDocument(),
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('redirects to /login when unauthenticated (RequireAuth)', async () => {
    useAuthStore.setState({ status: 'unauthenticated', user: null });
    render(
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/playlists" element={<PlaylistsPage />} />
        </Route>
        {/* /login SIBLING outside RequireAuth (see mountPage note). */}
        <Route path="/login" element={<div data-testid="login-page" />} />
      </Routes>,
      { routeInitialEntries: ['/playlists'] },
    );
    // Synchronous redirect (React Router <Navigate> resolves immediately); no
    // waitFor needed — matches the canonical RequireAuth.spec.tsx pattern.
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.queryByText(/no playlists yet/i)).not.toBeInTheDocument();
  });
});
