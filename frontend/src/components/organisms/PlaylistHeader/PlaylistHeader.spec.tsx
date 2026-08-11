import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PlaylistPrimitive } from '@/types/api';
import { PlaylistHeader } from './PlaylistHeader';

/**
 * FE-PR3-04 — PlaylistHeader organism (REQ-FE-015).
 *
 * Presentational: renders a `PlaylistPrimitive` (title + metadata) + the
 * "Play playlist" button that delegates to the page's `onPlay` handoff (which
 * calls `playerStore.playFromList(tracks, 0)` at the page level — the header
 * owns no store read, keeping it a pure presentational seam).
 */
const P1: PlaylistPrimitive = {
  id: 'P1',
  userId: 'u',
  title: 'Road trip',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

describe('PlaylistHeader (REQ-FE-015)', () => {
  it('renders the playlist title + a "Play playlist" button', () => {
    render(<PlaylistHeader playlist={P1} onPlay={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Road trip' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /play playlist/i }),
    ).toBeInTheDocument();
  });

  it('invokes onPlay when the "Play playlist" button is clicked', () => {
    const onPlay = vi.fn();
    render(<PlaylistHeader playlist={P1} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('button', { name: /play playlist/i }));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
