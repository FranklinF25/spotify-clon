import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AlbumSummary } from '@/types/api';
import { AlbumCard } from './AlbumCard';

/**
 * FE-PR3-02 — AlbumCard molecule (REQ-FE-009, DESIGN §7).
 * Presentational: composes atoms (cover image + Text + a play Button). Props in
 * (AlbumSummary), events out (onPlay?). The container page decides what the
 * play click does (playerStore.playFromList). Reads NO store (architecture rule).
 */
const album: AlbumSummary = {
  id: 'album-123',
  title: 'Kind of Blue',
  releaseYear: 1959,
  coverUrl: null,
  artist: { id: 'artist-1', name: 'Miles Davis' },
};

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      {ui}
    </MemoryRouter>,
  );
}

describe('AlbumCard molecule', () => {
  it('renders the album title and artist name', () => {
    renderWithRouter(<AlbumCard album={album} />);
    expect(screen.getByText('Kind of Blue')).toBeInTheDocument();
    expect(screen.getByText('Miles Davis')).toBeInTheDocument();
  });

  it('links to the album detail route /albums/:id', () => {
    renderWithRouter(<AlbumCard album={album} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/albums/album-123');
  });

  it('renders a decorative cover (empty alt) when coverUrl is null', () => {
    // Empty-alt imgs are removed from the a11y tree (decorative), so query the
    // DOM node directly instead of getByRole — proves the img rendered + that
    // its alt is empty (REQ-FE-009 empty-alt fallback).
    const { container } = renderWithRouter(<AlbumCard album={album} />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('alt')).toBe('');
  });

  it('renders the cover image with a descriptive alt when coverUrl is set', () => {
    renderWithRouter(
      <AlbumCard
        album={{ ...album, coverUrl: 'https://example.com/cover.jpg' }}
      />,
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://example.com/cover.jpg');
    expect(img.getAttribute('alt')).toBe('Kind of Blue cover');
  });

  it('emits onPlay(album) when the play button is clicked', () => {
    const onPlay = vi.fn();
    renderWithRouter(<AlbumCard album={album} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(album);
  });

  it('does not render a play button when onPlay is not provided', () => {
    renderWithRouter(<AlbumCard album={album} />);
    expect(screen.queryByRole('button', { name: /play/i })).toBeNull();
  });
});
