import { useAlbums } from '@/features/catalog/hooks/use-albums';
import { AlbumGrid } from '@/components/organisms/AlbumGrid/AlbumGrid';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import { Button } from '@/components/atoms/Button/Button';
import styles from './HomePage.module.css';

/**
 * HomePage (REQ-FE-009). The featured shelf = the first page of /albums.
 *
 * Container: reads `useAlbums({page:1, pageSize:20})` (TanStack Query owns the
 * cache) + renders `<AlbumGrid>`. Does NOT read playerStore (Home has no play
 * action — albums are browsed, not played from here; the play affordance lives
 * on AlbumPage). Loading → Spinner; error → QueryCache.onError toast (wired in
 * PR-2) + an inline "Try again" affordance that refetches.
 */
export function HomePage() {
  const { data, isLoading, isError, refetch } = useAlbums({
    page: 1,
    pageSize: 20,
  });

  if (isLoading) {
    return (
      <section className={styles.home}>
        <h1 className={styles.heading}>Featured</h1>
        <Spinner aria-label="Loading featured albums" />
      </section>
    );
  }

  if (isError) {
    return (
      <section className={styles.home}>
        <h1 className={styles.heading}>Featured</h1>
        <p className={styles.errorText}>Couldn't load albums.</p>
        <Button variant="secondary" onClick={() => void refetch()}>
          Try again
        </Button>
      </section>
    );
  }

  return (
    <section className={styles.home}>
      <h1 className={styles.heading}>Featured</h1>
      {data ? <AlbumGrid albums={data.items} /> : null}
    </section>
  );
}
