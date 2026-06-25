import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFoundPage } from './NotFoundPage';

/**
 * FE-PR3-15 — NotFoundPage (REQ-FE-009). Honest 404 for content misses.
 * Presentational so AlbumPage/ArtistPage can compose it inline (NOT a route
 * element only) + available as a routed fallback. Renders a friendly message +
 * a link home.
 */
describe('NotFoundPage', () => {
  it('renders an honest not-found message (no raw error leak)', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/we couldn't find that/i),
    ).toBeInTheDocument();
  });

  it('offers a link back home', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    const home = screen.getByRole('link', { name: /home/i });
    expect(home).toHaveAttribute('href', '/');
  });

  it('renders a custom message when provided (inline composition by pages)', () => {
    render(
      <MemoryRouter>
        <NotFoundPage message="This album is gone" />
      </MemoryRouter>,
    );
    expect(screen.getByText('This album is gone')).toBeInTheDocument();
  });
});
