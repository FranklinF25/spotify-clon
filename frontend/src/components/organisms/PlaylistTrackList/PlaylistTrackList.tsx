import { useState } from 'react';
import type { TrackPrimitive } from '@/types/api';
import { useRemoveTrack } from '@/features/playlists/hooks/use-remove-track';
import { useReorderTracks } from '@/features/playlists/hooks/use-reorder-tracks';
import { ApiError } from '@/lib/api/http-client';
import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import styles from './PlaylistTrackList.module.css';

/**
 * PlaylistTrackList organism (REQ-FE-015, DESIGN §7).
 *
 * Presentational + mutation hooks: receives the hydrated `TrackPrimitive[]`
 * from the page (the page owns the single `usePlaylistTracks(id)` read, so the
 * query fires exactly once — mirroring AlbumPage/TrackList). Owns the per-row
 * remove + reorder (up/down) affordances via `useRemoveTrack` and
 * `useReorderTracks`. Positions are 1-indexed (the API path segment
 * `DELETE /tracks/:position` + the `reorder { from, to }` body are 1-indexed).
 *
 * R6 LOCK honored: both mutation hooks invalidate via `onSuccess`/`onSettled`
 * (NO `onMutate` — NO optimistic UI). The list NEVER mutates client-side; the
 * page's refetch is the single source of truth. A 403 (non-owner) therefore
 * leaves the local list unchanged and surfaces an honest error.
 */
interface PlaylistTrackListProps {
  playlistId: string;
  tracks: TrackPrimitive[];
  isLoading: boolean;
}

export function PlaylistTrackList({
  playlistId,
  tracks,
  isLoading,
}: PlaylistTrackListProps) {
  const removeTrack = useRemoveTrack();
  const reorderTracks = useReorderTracks();

  // Surface mutation errors honestly at the control that triggered them.
  const mutationError = removeTrack.error ?? reorderTracks.error;
  const ownerMessage =
    mutationError instanceof ApiError && mutationError.code === 'FORBIDDEN'
      ? 'You are not the owner of this playlist.'
      : null;

  const [busyPosition, setBusyPosition] = useState<number | null>(null);

  if (isLoading) {
    return (
      <section className={styles.section}>
        <Spinner aria-label="Loading tracks" />
      </section>
    );
  }

  if (tracks.length === 0) {
    return (
      <section className={styles.section}>
        <p className={styles.empty}>No tracks yet</p>
      </section>
    );
  }

  const handleRemove = async (position: number) => {
    setBusyPosition(position);
    try {
      await removeTrack.mutateAsync({ id: playlistId, position });
    } catch {
      // surfaced via `removeTrack.error` above (honest; NO optimistic mutate)
    } finally {
      setBusyPosition(null);
    }
  };

  const handleReorder = async (from: number, to: number) => {
    setBusyPosition(from);
    try {
      await reorderTracks.mutateAsync({ id: playlistId, from, to });
    } catch {
      // surfaced via `reorderTracks.error` above
    } finally {
      setBusyPosition(null);
    }
  };

  return (
    <section className={styles.section}>
      {ownerMessage && (
        <p className={styles.error} role="alert">
          {ownerMessage}
        </p>
      )}
      <ol className={styles.list} aria-label="Playlist tracks">
        {tracks.map((track, index) => {
          const position = index + 1;
          return (
            <TrackRow
              key={`${track.id}-${index}`}
              track={track}
              position={position}
              isFirst={index === 0}
              isLast={index === tracks.length - 1}
              busy={busyPosition === position}
              onRemove={() => handleRemove(position)}
              onMoveUp={() => handleReorder(position, position - 1)}
              onMoveDown={() => handleReorder(position, position + 1)}
            />
          );
        })}
      </ol>
    </section>
  );
}

interface TrackRowProps {
  track: TrackPrimitive;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function TrackRow({
  track,
  position,
  isFirst,
  isLast,
  busy,
  onRemove,
  onMoveUp,
  onMoveDown,
}: TrackRowProps) {
  return (
    <li className={styles.row}>
      <span className={styles.position} aria-hidden="true">
        {position}
      </span>
      <span className={styles.title}>{track.title}</span>
      <span className={styles.actions}>
        <Button
          variant="ghost"
          aria-label={`Move ${track.title} up`}
          className={styles.iconBtn}
          disabled={isFirst || busy}
          onClick={onMoveUp}
        >
          <Icon name="prev" size={16} aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          aria-label={`Move ${track.title} down`}
          className={styles.iconBtn}
          disabled={isLast || busy}
          onClick={onMoveDown}
        >
          <Icon name="next" size={16} aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          aria-label={`Remove ${track.title}`}
          className={styles.iconBtn}
          disabled={busy}
          onClick={onRemove}
        >
          <Icon name="playlist" size={16} aria-hidden="true" />
        </Button>
      </span>
    </li>
  );
}
