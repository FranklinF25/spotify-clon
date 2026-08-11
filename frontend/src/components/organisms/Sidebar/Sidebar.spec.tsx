import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http } from 'msw';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { server } from '@/test/msw/server';
import { Sidebar } from './Sidebar';

/**
 * FE-PR3-05 — Sidebar REQ-FE-013 graduation + R-app-4 active-state test.
 *
 * Playlists graduates from a disabled stub into a live `<NavLink to="/playlists">`
 * (F5 closed). Library STAYS a disabled "coming soon" placeholder (F6 backend
 * context still `.gitkeep`-only).
 *
 * R-app-4 (load-bearing): the active-state test mounts the Sidebar at
 * `/playlists/P1` and asserts the Playlists NavLink receives the `active`
 * class via React Router v6 prefix matching (the default — `/playlists` with
 * NO `end` is active for both `/playlists` and `/playlists/:id`). Without this
 * test the prefix-matching behavior is assumed, not proven. Verified against
 * react-router-dom@6.30.4 `NavLink` className composition
 * (`[classNameProp, isActive ? "active" : null].filter(Boolean).join(" ")`).
 */
function renderSidebarAt(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Sidebar — REQ-FE-013 graduation (Playlists live, Library stubbed)', () => {
  it('renders the nav landmark', () => {
    renderSidebarAt('/');
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders Home + Search + Playlists as real NavLinks', () => {
    renderSidebarAt('/');
    const home = screen.getByRole('link', { name: /home/i });
    const search = screen.getByRole('link', { name: /search/i });
    const playlists = screen.getByRole('link', { name: /playlists/i });
    expect(home).toHaveAttribute('href', '/');
    expect(search).toHaveAttribute('href', '/search');
    expect(playlists).toHaveAttribute('href', '/playlists');
  });

  it('Playlists is NOT a disabled stub (no disabled, no aria-disabled, no coming-soon badge)', () => {
    renderSidebarAt('/');
    const playlists = screen.getByRole('link', { name: /playlists/i });
    expect(playlists).not.toHaveAttribute('disabled');
    expect(playlists).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('Library remains a disabled placeholder (REQ-FE-013 regression guard)', () => {
    renderSidebarAt('/');
    const library = screen.getByRole('button', { name: /library/i });
    expect(library).toBeDisabled();
    expect(library).toHaveAttribute('aria-disabled', 'true');
    expect(library.tagName).toBe('BUTTON');
    // Exactly ONE "coming soon" badge remains — Library only.
    expect(screen.getAllByText(/coming soon/i)).toHaveLength(1);
  });

  it('R-app-4: Playlists NavLink is active on /playlists/:id (prefix matching)', () => {
    renderSidebarAt('/playlists/P1');
    const playlists = screen.getByRole('link', { name: /playlists/i });
    expect(playlists).toHaveClass('active');
    expect(playlists).toHaveAttribute('aria-current', 'page');
  });

  it('Playlists NavLink is also active on /playlists (index)', () => {
    renderSidebarAt('/playlists');
    const playlists = screen.getByRole('link', { name: /playlists/i });
    expect(playlists).toHaveClass('active');
  });

  it('clicking the disabled Library entry fires NO network request + no nav', () => {
    const spy = vi.fn();
    server.use(http.get('*/api/v1/library*', spy));
    renderSidebarAt('/');
    const library = screen.getByRole('button', { name: /library/i });
    library.click(); // disabled buttons don't fire handlers, but assert honesty
    expect(spy).not.toHaveBeenCalled();
  });
});
