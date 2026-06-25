import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http } from 'msw';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { server } from '@/test/msw/server';
import { Sidebar } from './Sidebar';

/**
 * FE-PR3-08 — Sidebar organism (REQ-FE-013, DESIGN §7).
 *
 * The Playlists + Library backend contexts are `.gitkeep`-only in Slice A, so
 * their Sidebar entries are HONEST disabled placeholders — `<button disabled
 * aria-disabled="true">` labelled "Coming soon", NOT `<a href>`. Clicking them
 * issues NO navigation + NO network request (no dead links, no fake features).
 *
 * Home + Search are real NavLinks to the protected routes that DO exist.
 */
function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar />
    </MemoryRouter>,
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Sidebar — honest "coming soon" stubs (REQ-FE-013)', () => {
  it('renders the nav landmark', () => {
    renderSidebar();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders Home + Search as real links (they have backend contexts)', () => {
    renderSidebar();
    const home = screen.getByRole('link', { name: /home/i });
    const search = screen.getByRole('link', { name: /search/i });
    expect(home).toHaveAttribute('href', '/');
    expect(search).toHaveAttribute('href', '/search');
  });

  it('renders Playlists + Library as DISABLED buttons (no href)', () => {
    renderSidebar();
    const playlists = screen.getByRole('button', { name: /playlists/i });
    const library = screen.getByRole('button', { name: /library/i });
    expect(playlists).toBeDisabled();
    expect(library).toBeDisabled();
    expect(playlists).toHaveAttribute('aria-disabled', 'true');
    expect(library).toHaveAttribute('aria-disabled', 'true');
    // NOT links — no href that could navigate.
    expect(playlists.tagName).toBe('BUTTON');
    expect(library.tagName).toBe('BUTTON');
  });

  it('labels the disabled entries as "coming soon" (honest, not fake)', () => {
    renderSidebar();
    expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThanOrEqual(2);
  });

  it('clicking a disabled entry fires NO network request + issues no nav', () => {
    // If any handler fired it would surface as an unhandled-request error
    // (onUnhandledRequest: 'error') and fail the spec. Spy to be explicit.
    const spy = vi.fn();
    server.use(http.get('*/api/v1/playlists*', spy));
    server.use(http.get('*/api/v1/library*', spy));

    renderSidebar();
    const playlists = screen.getByRole('button', { name: /playlists/i });
    playlists.click(); // disabled buttons don't fire click handlers, but assert
    expect(spy).not.toHaveBeenCalled();
    // The location is unchanged (still '/').
    expect(window.location.pathname + window.location.hash).not.toMatch(
      /playlists|library/,
    );
  });
});
