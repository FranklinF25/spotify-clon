import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { usePlaylist } from '@/features/playlists/hooks/use-playlist';
import { usePlaylistTracks } from '@/features/playlists/hooks/use-playlist-tracks';
import { useAddTrack } from '@/features/playlists/hooks/use-add-track';
import { searchQueryOptions } from '@/features/search/hooks/use-search';
import { usePlayerStore } from '@/store/player.store';
import { ApiError } from '@/lib/api/http-client';
import type { TrackSummary } from '@/types/api';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import { PlaylistHeader } from '@/components/organisms/PlaylistHeader/PlaylistHeader';
import { PlaylistTrackList } from '@/components/organisms/PlaylistTrackList/PlaylistTrackList';
import { AddTrackPicker } from '@/components/molecules/AddTrackPicker/AddTrackPicker';
import { NotFoundPage } from './NotFoundPage';
import styles from './PlaylistDetailPage.module.css';

/**
 * PlaylistDetailPage (REQ-FE-015). Composes the header + track list + the
 * AddTrackPicker search UX (the old AddTrackForm asked for a raw track UUID
 * nobody knows; the picker is the Spotify model — search, click, added).
 *
 * The "Play playlist" handoff is the ENTIRE playback integration (LOCKED
 * design §12.4):
 *   const tracks = usePlaylistTracks(id).data ?? [];
 *   const playFromList = usePlayerStore((s) => s.playFromList);
 *   const onPlay = () => playFromList(tracks, 0);
 * `playerStore.playFromList` is REUSED UNCHANGED (zero store change). `next()`
 * stops at end-of-queue (REQ-FE-011, reused).
 *
 * Search seam: the picker owns the debounce in LOCAL state, so `q` is only
 * known at callback time — a useSearch(q) hook argument could never update.
 * The adapter therefore PULLS via `queryClient.fetchQuery(searchQueryOptions(
 * q, 'track'))` — the SAME options object the hook delegates to (single
 * source of truth in use-search.ts), so the cache key `['search', q, 'track']`
 * and staleTime are shared with SearchPage verbatim; nothing is duplicated.
 * The empty-q guard mirrors the hook's `enabled` (fetchQuery is imperative
 * and does not consult `enabled`).
 *
 * Honest states: 404 NOT_FOUND → inline NotFoundPage (no crash). Mutations
 * surface their own errors at their control (PlaylistTrackList /
 * AddTrackPicker).
 */
export function PlaylistDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: playlist, isLoading, error } = usePlaylist(id);
  const tracksQuery = usePlaylistTracks(id);
  const addTrack = useAddTrack();
  const playFromList = usePlayerStore((s) => s.playFromList);

  // Stable identity — the picker's search effect lists onSearch as a dep;
  // an inline closure would re-fire it on every page render.
  const searchTracks = useCallback(
    async (q: string): Promise<TrackSummary[]> => {
      if (q.length === 0) return [];
      const data = await queryClient.fetchQuery(searchQueryOptions(q, 'track'));
      return data.tracks;
    },
    [queryClient],
  );
  const addTrackById = useCallback(
    (trackId: string) => addTrack.mutateAsync({ id, trackId }),
    [addTrack, id],
  );

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
      <AddTrackPicker
        onSearch={searchTracks}
        onAdd={addTrackById}
        isAddPending={addTrack.isPending}
      />
    </section>
  );
}
