import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildAlbum } from '@/test/fakes';
import { AlbumGrid } from './AlbumGrid';

/**
 * FE-PR3-07 — AlbumGrid organism (DESIGN §7). Presentational wrapper: maps an
 * `AlbumSummary[]` to one `<AlbumCard>` per item. The page owns the TanStack
 * Query read; the grid owns the layout. Composes the AlbumCard molecule only.
 */
function renderGrid(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('AlbumGrid organism', () => {
  it('renders one card per album', () => {
    const albums = [
      buildAlbum({ id: 'a1', title: 'Alpha' }),
      buildAlbum({ id: 'a2', title: 'Beta' }),
      buildAlbum({ id: 'a3', title: 'Gamma' }),
    ];
    renderGrid(<AlbumGrid albums={albums} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    // Each card is a link → 3 links.
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('renders nothing when the list is empty (no crash)', () => {
    renderGrid(<AlbumGrid albums={[]} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('forwards onPlay down to each card (emitted upward with the album)', () => {
    const albums = [buildAlbum({ id: 'a1', title: 'Solo' })];
    const onPlay = vi.fn();
    renderGrid(<AlbumGrid albums={albums} onPlay={onPlay} />);
    screen.getByRole('button', { name: /play solo/i }).click();
    expect(onPlay).toHaveBeenCalledWith(albums[0]);
  });
});
