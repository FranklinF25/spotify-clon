import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PlaylistSummary } from '@/types/api';
import { PlaylistCard } from './PlaylistCard';

/**
 * FE-PR3-03 — PlaylistCard molecule (REQ-FE-014, DESIGN §7).
 * Presentational: renders a PlaylistSummary (title + createdAt) and links to
 * /playlists/:id. Mirrors AlbumCard. Reads NO store (architecture rule).
 */
const playlist: PlaylistSummary = {
  id: 'P1',
  title: 'Road trip',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter>{ui}</MemoryRouter>,
  );
}

describe('PlaylistCard molecule (REQ-FE-014)', () => {
  it('renders the playlist title', () => {
    renderWithRouter(<PlaylistCard playlist={playlist} />);
    expect(screen.getByText('Road trip')).toBeInTheDocument();
  });

  it('links to the playlist detail route /playlists/:id', () => {
    renderWithRouter(<PlaylistCard playlist={playlist} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/playlists/P1');
  });
});
