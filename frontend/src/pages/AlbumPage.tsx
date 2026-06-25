import { useParams, Link } from 'react-router-dom';
import { useAlbum } from '@/features/catalog/hooks/use-album';
import { TrackList } from '@/components/organisms/TrackList/TrackList';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';
import { NotFoundPage } from './NotFoundPage';
import { usePlayerStore } from '@/store/player.store';
import { ApiError } from '@/lib/api/http-client';
import styles from './AlbumPage.module.css';

/**
 * AlbumPage (REQ-FE-009). Album detail + embedded tracks.
 *
 * Container: reads `:id` + `useAlbum(id)`, renders the album header (cover,
 * title, artist link) + `<TrackList onPlay={...}>`. "Play album" + each track
 * play button seed the implicit queue via `playerStore.playFromList(tracks, i)`
 * (the implicit-queue contract from TrackList). On `NOT_FOUND` renders the
 * honest inline NotFoundPage (no crash — REQ-FE-009 scenario "Missing album
 * renders a not-found state").
 */
export function AlbumPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useAlbum(id);
  const playFromList = usePlayerStore((s) => s.playFromList);

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
        </div>
      </header>

      <TrackList
        tracks={data.tracks}
        onPlay={(_track, index) => playFromList(data.tracks, index)}
      />
    </section>
  );
}
