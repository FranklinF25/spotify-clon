import { useParams } from 'react-router-dom';
import { usePlaylist } from '@/features/playlists/hooks/use-playlist';
import { usePlaylistTracks } from '@/features/playlists/hooks/use-playlist-tracks';
import { useAddTrack } from '@/features/playlists/hooks/use-add-track';
import { usePlayerStore } from '@/store/player.store';
import { ApiError } from '@/lib/api/http-client';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import { PlaylistHeader } from '@/components/organisms/PlaylistHeader/PlaylistHeader';
import { PlaylistTrackList } from '@/components/organisms/PlaylistTrackList/PlaylistTrackList';
import { AddTrackForm } from '@/components/molecules/AddTrackForm/AddTrackForm';
import { NotFoundPage } from './NotFoundPage';
import styles from './PlaylistDetailPage.module.css';

/**
 * PlaylistDetailPage (REQ-FE-015). Composes the header + track list + add form.
 *
 * The "Play playlist" handoff is the ENTIRE playback integration (LOCKED
 * design §12.4):
 *   const tracks = usePlaylistTracks(id).data ?? [];
 *   const playFromList = usePlayerStore((s) => s.playFromList);
 *   const onPlay = () => playFromList(tracks, 0);
 * `playerStore.playFromList` is REUSED UNCHANGED (zero store change). `next()`
 * stops at end-of-queue (REQ-FE-011, reused).
 *
 * Honest states: 404 NOT_FOUND → inline NotFoundPage (no crash). Mutations
 * surface their own errors at their control (PlaylistTrackList / AddTrackForm).
 */
export function PlaylistDetailPage() {
  const { id = '' } = useParams();
  const { data: playlist, isLoading, error } = usePlaylist(id);
  const tracksQuery = usePlaylistTracks(id);
  const addTrack = useAddTrack();
  const playFromList = usePlayerStore((s) => s.playFromList);

  const tracks = tracksQuery.data ?? [];
  const onPlay = () => {
    if (tracks.length > 0) playFromList(tracks, 0);
  };

  if (isLoading) {
    return (
      <section className={styles.page}>
        <Spinner aria-label="Loading playlist" />
      </section>
    );
  }

  if (error instanceof ApiError && error.code === 'NOT_FOUND') {
    return <NotFoundPage message="We couldn't find that playlist" />;
  }

  if (!playlist) {
    // Any other error: QueryCache.onError surfaces a toast; keep the page quiet.
    return null;
  }

  return (
    <section className={styles.page}>
      <PlaylistHeader playlist={playlist} onPlay={onPlay} />
      <PlaylistTrackList
        playlistId={id}
        tracks={tracks}
        isLoading={tracksQuery.isLoading}
      />
      <AddTrackForm
        onSubmit={(trackId) => addTrack.mutateAsync({ id, trackId })}
        isPending={addTrack.isPending}
      />
    </section>
  );
}
