import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './AppLayout';

/**
 * FE-PR3-10 — AppLayout template (REQ-FE-008, DESIGN §8, §11.1).
 *
 * The PROTECTED shell: Sidebar + Topbar + `<main><Outlet/></main>` + a player
 * `<footer role="region" aria-label="Player">` hosting `<PlayerBarSlot/>`
 * (an empty placeholder — the real PlayerBar lands in FE-PR4-04; sequencing
 * refinement so PR-3 is independently coherent without a no-op PlayerBar stub).
 *
 * Verifies the four Spotify-like chrome landmarks are present + labelled.
 */
function renderLayoutAt(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<div>Page content</div>} />
          <Route path="/albums/:id" element={<div>Album page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppLayout template — Spotify-like chrome landmarks (REQ-FE-008)', () => {
  it('renders the nav landmark (Sidebar)', () => {
    renderLayoutAt();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders the header landmark (Topbar)', () => {
    renderLayoutAt();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('renders the main landmark with the Outlet content', () => {
    renderLayoutAt();
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(main).toHaveTextContent('Page content');
  });

  it('renders the player region landmark labelled for assistive tech', () => {
    renderLayoutAt();
    expect(
      screen.getByRole('region', { name: /player/i }),
    ).toBeInTheDocument();
  });

  it('renders the matched nested route through the Outlet (/albums/:id)', () => {
    // The Outlet wires the matched child route; the player region stays
    // present. (The no-remount RUNTIME guarantee is the PR-4 single-mount
    // audio-element-identity test, FE-PR4-04 — out of scope here.)
    renderLayoutAt('/albums/123');
    expect(screen.getByText('Album page')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /player/i })).toBeInTheDocument();
  });
});
