import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PlaylistSummary } from '@/types/api';
import { PlaylistGrid } from './PlaylistGrid';

/**
 * FE-PR3-03 — PlaylistGrid organism (REQ-FE-014, DESIGN §7).
 * Presentational wrapper: maps PlaylistSummary[] → PlaylistCard[]. Mirrors
 * AlbumGrid. Empty array → null (the page owns the empty-state copy).
 */
const TWO: PlaylistSummary[] = [
  { id: 'P1', title: 'Road trip', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
  { id: 'P2', title: 'Workout', createdAt: '2025-01-02T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z' },
];

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('PlaylistGrid organism (REQ-FE-014)', () => {
  it('renders one link per playlist', () => {
    renderWithRouter(<PlaylistGrid playlists={TWO} />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('renders nothing when the list is empty', () => {
    const { container } = renderWithRouter(<PlaylistGrid playlists={[]} />);
    expect(container.querySelector('ul')).toBeNull();
  });
});
