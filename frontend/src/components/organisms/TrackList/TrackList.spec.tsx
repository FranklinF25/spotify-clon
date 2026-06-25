import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { buildTrack } from '@/test/fakes';
import type { TrackPrimitive } from '@/types/api';
import { TrackList } from './TrackList';

/**
 * FE-PR3-07 — TrackList organism (DESIGN §7). Owns the implicit-queue
 * contract: renders one `<TrackRow>` per track and propagates `onPlay` with the
 * SURROUNDING LIST so the parent page can call
 * `playerStore.playFromList(list, index)`. The page is the container
 * (playerStore call); TrackList is presentational + owns the list layout.
 */
describe('TrackList organism', () => {
  it('renders one row per track', () => {
    const tracks = [
      buildTrack({ id: 't1', title: 'First', trackNumber: 1 }),
      buildTrack({ id: 't2', title: 'Second', trackNumber: 2 }),
    ];
    render(<TrackList tracks={tracks} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('propagates onPlay with the track, its index, AND the surrounding list', () => {
    const tracks: TrackPrimitive[] = [
      buildTrack({ id: 't1', title: 'First', trackNumber: 1, albumId: 'a1' }),
      buildTrack({ id: 't2', title: 'Second', trackNumber: 2, albumId: 'a1' }),
      buildTrack({ id: 't3', title: 'Third', trackNumber: 3, albumId: 'a1' }),
    ];
    const onPlay = vi.fn();
    render(<TrackList tracks={tracks} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('button', { name: /play second/i }));
    // The implicit-queue contract: onPlay carries (track, index, full list).
    expect(onPlay).toHaveBeenCalledWith(tracks[1], 1, tracks);
  });

  it('renders nothing when the list is empty (no crash)', () => {
    render(<TrackList tracks={[]} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('does NOT render play buttons when onPlay is omitted', () => {
    const tracks = [buildTrack({ id: 't1', title: 'Solo', trackNumber: 1 })];
    render(<TrackList tracks={tracks} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
