import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration';

/**
 * `formatDuration` — pure mm:ss helper (DESIGN §7, FE-PR3-03). Shared by
 * TrackRow + the future PlayerBar. Edge cases asserted directly.
 */
describe('formatDuration', () => {
  it('formats sub-hour durations as m:ss with zero padding', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(567)).toBe('9:27');
  });

  it('formats exactly one hour as 1:00:00', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
  });

  it('formats hour+ durations as h:mm:ss', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('clamps negative inputs to 0:00 (defensive against bad metadata)', () => {
    expect(formatDuration(-10)).toBe('0:00');
  });

  it('floors fractional seconds (never rounds up past the real duration)', () => {
    expect(formatDuration(9.9)).toBe('0:09');
  });
});
