import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import { RequireAuth } from '@/app/RequireAuth';
import { LibraryPage } from '@/pages/LibraryPage';
import { Sidebar } from './Sidebar';

/**
 * F6 WORK-PR3-06 — Sidebar REQ-FE-013 TERMINAL state.
 *
 * Library graduates from the disabled stub into a live
 * `<NavLink to="/library">` now that the full library vertical exists.
 * ZERO stubs remain (the StubItem/STUBS machinery is deleted outright).
 */
function renderSidebarAt(initial: string) {
  return render(
    <Sidebar />,
    { routeInitialEntries: [initial] },
  );
}

function renderNavTree(initial: string) {
  useAuthStore.setState({
    status: 'authenticated' as const,
    user: { id: 'u', email: 'a@b.co', displayName: 'A' },
    accessToken: 'tok',
    bootRefreshStarted: false,
  });
  return render(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Sidebar />} />
        <Route path="/library" element={<LibraryPage />} />
      </Route>
      <Route path="/login" element={<div data-testid="login-page" />} />
    </Routes>,
    { routeInitialEntries: [initial] },
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Sidebar — REQ-FE-013 terminal state (zero stubs)', () => {
  it('renders the nav landmark', () => {
    renderSidebarAt('/');
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders Home + Search + Playlists + Library as real NavLinks', () => {
    renderSidebarAt('/');
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute(
      'href',
      '/home',
    );
    expect(screen.getByRole('link', { name: /search/i })).toHaveAttribute(
      'href',
      '/search',
    );
    expect(screen.getByRole('link', { name: /playlists/i })).toHaveAttribute(
      'href',
      '/playlists',
    );
    expect(screen.getByRole('link', { name: /library/i })).toHaveAttribute(
      'href',
      '/library',
    );
  });

  it('Library is a live NavLink — not disabled, no coming-soon badge', () => {
    renderSidebarAt('/');
    const library = screen.getByRole('link', { name: /library/i });
    expect(library.tagName).toBe('A');
    expect(library).not.toHaveAttribute('disabled');
    expect(library).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryAllByText(/coming soon/i)).toHaveLength(0);
  });

  it('no stub buttons remain — every entry is a live link', () => {
    renderSidebarAt('/');
    // All four entries are links; zero disabled <button> placeholders.
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('Library NavLink is active on /library (prefix matching, aria-current)', () => {
    renderSidebarAt('/library');
    const library = screen.getByRole('link', { name: /library/i });
    expect(library).toHaveClass('active');
    expect(library).toHaveAttribute('aria-current', 'page');
  });

  it('clicking Library navigates and the unified page renders', async () => {
    server.use(
      http.get(endpoints.playlists.list, () => HttpResponse.json([])),
      http.get(endpoints.library.albums, () => HttpResponse.json([])),
    );
    renderNavTree('/');
    fireEvent.click(screen.getByRole('link', { name: /library/i }));
    // A REAL page answers — the unified "Mi biblioteca" heading.
    expect(
      await screen.findByRole('heading', { name: /mi biblioteca/i }),
    ).toBeInTheDocument();
  });
});
