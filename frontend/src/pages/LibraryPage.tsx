import { useState } from 'react';
import { usePlaylists } from '@/features/playlists/hooks/use-playlists';
import { useLibraryAlbums } from '@/features/library/hooks/use-library-albums';
import { PlaylistGrid } from '@/components/organisms/PlaylistGrid/PlaylistGrid';
import { AlbumGrid } from '@/components/organisms/AlbumGrid/AlbumGrid';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import { Button } from '@/components/atoms/Button/Button';
import styles from './LibraryPage.module.css';

/**
 * LibraryPage (REQ-FE-016; DESIGN §9.3). The unified "Mi biblioteca":
 * client-side composition of TWO independent caches (REQ-L-007 — no
 * backend aggregation): the existing owner-scoped playlists list
 * (['playlists','list'], already createdAt desc server-side) and the
 * saved-albums list (['library','albums'], addedAt desc server-side).
 *
 * Honest states are PER-SECTION: one source failing never blanks the
 * other. The type filter is local useState (D7 — no URL param). No
 * `onPlay` is passed to AlbumGrid: opening a saved album navigates to
 * the album page exactly as today.
 */
type LibraryFilter = 'all' | 'playlists' | 'albums';

const FILTERS: readonly { value: LibraryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'playlists', label: 'Playlists' },
  { value: 'albums', label: 'Albums' },
];

export function LibraryPage() {
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const playlists = usePlaylists();
  const library = useLibraryAlbums();

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Mi biblioteca</h1>
        <div className={styles.filter} role="group" aria-label="Filter by type">
          {FILTERS.map(({ value, label }) => (
            <Button
              key={value}
              variant={filter === value ? 'primary' : 'secondary'}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </header>

      {filter !== 'albums' && (
        <section className={styles.section} aria-label="Playlists">
          <h2 className={styles.sectionTitle}>Playlists</h2>
          {playlists.isLoading ? (
            <Spinner aria-label="Loading playlists" />
          ) : playlists.isError ? (
            <p className={styles.error}>Couldn't load playlists.</p>
          ) : (playlists.data ?? []).length === 0 ? (
            <p className={styles.empty}>No playlists yet</p>
          ) : (
            <PlaylistGrid playlists={playlists.data!} />
          )}
        </section>
      )}

      {filter !== 'playlists' && (
        <section className={styles.section} aria-label="Álbumes">
          <h2 className={styles.sectionTitle}>Álbumes</h2>
          {library.isLoading ? (
            <Spinner aria-label="Loading saved albums" />
          ) : library.isError ? (
            <p className={styles.error}>Couldn't load saved albums.</p>
          ) : (library.data ?? []).length === 0 ? (
            <p className={styles.empty}>No albums saved yet</p>
          ) : (
            <AlbumGrid albums={library.data!.map((s) => s.album)} />
          )}
        </section>
      )}
    </section>
  );
}
