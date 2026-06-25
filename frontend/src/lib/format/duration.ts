/**
 * Format a duration in seconds as `m:ss` (or `h:mm:ss` for hour+ tracks).
 *
 * PURE function — extracted (strict-tdd extract-before-mock rule) so the mm:ss
 * edge cases are unit-testable directly. Shared by TrackRow (FE-PR3-03) and the
 * future PlayerBar (PR-4) elapsed/remaining displays.
 */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
