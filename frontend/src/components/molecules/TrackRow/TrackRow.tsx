import type { TrackPrimitive } from '@/types/api';
import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';
import { formatDuration } from '@/lib/format/duration';
import styles from './TrackRow.module.css';

/**
 * TrackRow molecule (REQ-FE-011, DESIGN §7). Presentational: composes atoms
 * (Button + Icon) over a TrackPrimitive. Emits `onPlay(track, index)` upward —
 * the container (TrackList → page) seeds the queue via
 * `playerStore.playFromList`. Reads NO store (§3 architecture rule forbids
 * molecules importing `store/`/`features/`/`pages/`).
 *
 * `index` is the 0-based position in the surrounding list (the implicit-queue
 * contract, DESIGN §7); the displayed number is the track's own `trackNumber`.
 */
interface TrackRowProps {
  track: TrackPrimitive;
  index: number;
  onPlay?: (track: TrackPrimitive, index: number) => void;
}

export function TrackRow({ track, index, onPlay }: TrackRowProps) {
  return (
    <li className={styles.row}>
      <span className={styles.number} aria-hidden="true">
        {track.trackNumber}
      </span>
      <span className={styles.title}>{track.title}</span>
      <span className={styles.duration}>
        {formatDuration(track.durationSeconds)}
      </span>
      {onPlay && (
        <Button
          variant="ghost"
          aria-label={`Play ${track.title}`}
          className={styles.play}
          onClick={() => onPlay(track, index)}
        >
          <Icon name="play" size={18} aria-hidden="true" />
        </Button>
      )}
    </li>
  );
}
