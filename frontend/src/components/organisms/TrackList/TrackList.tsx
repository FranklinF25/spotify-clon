import type { TrackPrimitive } from '@/types/api';
import { TrackRow } from '@/components/molecules/TrackRow/TrackRow';
import styles from './TrackList.module.css';

/**
 * TrackList organism (REQ-FE-011, DESIGN §7). Owns the **implicit-queue
 * contract**: renders one `<TrackRow>` per track and propagates `onPlay` with
 * the SURROUNDING LIST so the parent page can call
 * `playerStore.playFromList(list, index)`.
 *
 * Presentational + container-adjacent: it does NOT call playerStore itself
 * (that's the page's job); it just shapes the payload so any caller seeds the
 * implicit queue correctly.
 */
export type TrackListPlayHandler = (
  track: TrackPrimitive,
  index: number,
  list: TrackPrimitive[],
) => void;

interface TrackListProps {
  tracks: TrackPrimitive[];
  onPlay?: TrackListPlayHandler;
}

export function TrackList({ tracks, onPlay }: TrackListProps) {
  if (tracks.length === 0) return null;
  return (
    <ol className={styles.list}>
      {tracks.map((track, index) => (
        <TrackRow
          key={track.id}
          track={track}
          index={index}
          onPlay={
            onPlay
              ? (clickedTrack, clickedIndex) =>
                  onPlay(clickedTrack, clickedIndex, tracks)
              : undefined
          }
        />
      ))}
    </ol>
  );
}
