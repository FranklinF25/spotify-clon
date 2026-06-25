import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TrackPrimitive } from '@/types/api';
import { TrackRow } from './TrackRow';

/**
 * FE-PR3-03 — TrackRow molecule (REQ-FE-011, DESIGN §7).
 * Presentational: composes atoms (Button + play Icon) over a TrackPrimitive.
 * Emits onPlay(track, index) upward — the container (TrackList/page) seeds the
 * queue via playerStore.playFromList. Reads NO store (architecture rule).
 *
 * The mm:ss formatting lives in a pure `formatDuration` (lib/format/duration),
 * unit-tested in its own spec; this file asserts the component wires it through.
 */
const track: TrackPrimitive = {
  id: 'track-1',
  title: 'So What',
  durationSeconds: 567,
  trackNumber: 1,
  albumId: 'album-1',
};

describe('TrackRow molecule', () => {
  it('renders the track number, title, and formatted duration', () => {
    render(<TrackRow track={track} index={0} />);
    expect(screen.getByText('So What')).toBeInTheDocument();
    expect(screen.getByText('9:27')).toBeInTheDocument();
    // trackNumber renders (1-based from the track's own field).
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('emits onPlay(track, index) when the play button is clicked', () => {
    const onPlay = vi.fn();
    render(<TrackRow track={track} index={2} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(track, 2);
  });

  it('exposes the track title in the play button aria-label', () => {
    render(<TrackRow track={track} index={0} onPlay={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /play so what/i }),
    ).toBeInTheDocument();
  });

  it('formats the duration of a long (hour+) track without crashing', () => {
    const longTrack: TrackPrimitive = {
      ...track,
      title: 'Long One',
      durationSeconds: 3725,
    };
    render(<TrackRow track={longTrack} index={0} />);
    expect(screen.getByText('1:02:05')).toBeInTheDocument();
  });
});
