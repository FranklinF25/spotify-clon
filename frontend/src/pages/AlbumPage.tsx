import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAlbum } from '@/features/catalog/hooks/use-album';
import { useLibraryAlbums } from '@/features/library/hooks/use-library-albums';
import { useAddAlbumToLibrary } from '@/features/library/hooks/use-add-album-to-library';
import { useRemoveAlbumFromLibrary } from '@/features/library/hooks/use-remove-album-from-library';
import { SaveToLibraryButton } from '@/components/molecules/SaveToLibraryButton/SaveToLibraryButton';
import { TrackList } from '@/components/organisms/TrackList/TrackList';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';
import { NotFoundPage } from './NotFoundPage';
import { usePlayerStore } from '@/store/player.store';
import { ApiError } from '@/lib/api/http-client';
import styles from './AlbumPage.module.css';

/**
 * AlbumPage (REQ-FE-009 + REQ-FE-017). Album detail + embedded tracks +
 * the library save/remove affordance.
 *
 * Saved state is DERIVED from the single ['library','albums'] cache
 * (D-fe-3): `some(entry => entry.album.id === id)` — no dedicated
 * membership query, no mutation-local mirror. While the cache boots the
 * control is disabled (honest unknown). A failed mutation surfaces its
 * message ON the control via local actionError (D-fe-1 — the global
 * toast also fires once; redundancy accepted over widening
 * FORM_OWNED_CODES).
 */
export function AlbumPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useAlbum(id);
  const playFromList = usePlayerStore((s) => s.playFromList);
  const { data: library, isLoading: libraryLoading } = useLibraryAlbums();
  const save = useAddAlbumToLibrary();
  const remove = useRemoveAlbumFromLibrary();
  const [actionError, setActionError] = useState<string | null>(null);

  const isSaved = library?.some((entry) => entry.album.id === id) ?? false;

  const handleToggle = () => {
    setActionError(null);
    const result = isSaved ? remove.mutateAsync({ id }) : save.mutateAsync({ id });
    result.catch((err) => {
      // 422 (album no longer in catalog) and friends surface ON the control.
      setActionError(
        err instanceof ApiError ? err.message : 'Something went wrong',
      );
    });
  };

  if (isLoading) {
    return (
      <section className={styles.page}>
        <Spinner aria-label="Loading album" />
      </section>
    );
  }

  if (error instanceof ApiError && error.code === 'NOT_FOUND') {
    return <NotFoundPage message="We couldn't find that album" />;
  }

  if (!data) {
    // Any other error: QueryCache.onError surfaces a toast; keep the page quiet.
    return null;
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div className={styles.cover} aria-hidden="true" />
        <div className={styles.meta}>
          <h1 className={styles.title}>{data.title}</h1>
          <p className={styles.subtitle}>
            <Link to={`/artists/${data.artist.id}`} className={styles.artistLink}>
              {data.artist.name}
            </Link>
            {' · '}
            {data.releaseYear ?? '—'}
          </p>
          <Button
            variant="primary"
            aria-label="Play album"
            onClick={() => playFromList(data.tracks, 0)}
          >
            <Icon name="play" size={18} aria-hidden="true" /> Play
          </Button>
          <SaveToLibraryButton
            isSaved={isSaved}
            disabled={libraryLoading}
            isPending={save.isPending || remove.isPending}
            error={actionError}
            onToggle={handleToggle}
          />
        </div>
      </header>

      <TrackList
        tracks={data.tracks}
        onPlay={(_track, index) => playFromList(data.tracks, index)}
      />
    </section>
  );
}
