import { useParams } from 'react-router-dom';
import { useArtist } from '@/features/catalog/hooks/use-artist';
import { AlbumGrid } from '@/components/organisms/AlbumGrid/AlbumGrid';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import { NotFoundPage } from './NotFoundPage';
import { ApiError } from '@/lib/api/http-client';
import styles from './ArtistPage.module.css';

/**
 * ArtistPage (REQ-FE-009). Artist detail + embedded albums.
 *
 * Container: reads `:id` + `useArtist(id)`, renders the artist header (image,
 * name, bio) + `<AlbumGrid>` from the EMBEDDED `data.albums` (NOT a second
 * /albums hop — the detail projection already carries them). On `NOT_FOUND`
 * renders the honest inline NotFoundPage (mirrors AlbumPage).
 */
export function ArtistPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useArtist(id);

  if (isLoading) {
    return (
      <section className={styles.page}>
        <Spinner aria-label="Loading artist" />
      </section>
    );
  }

  if (error instanceof ApiError && error.code === 'NOT_FOUND') {
    return <NotFoundPage message="We couldn't find that artist" />;
  }

  if (!data) {
    return null;
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div className={styles.image} aria-hidden="true" />
        <div className={styles.meta}>
          <h1 className={styles.name}>{data.name}</h1>
          {data.bio ? <p className={styles.bio}>{data.bio}</p> : null}
        </div>
      </header>

      <h2 className={styles.discography}>Discography</h2>
      <AlbumGrid albums={data.albums} />
    </section>
  );
}
