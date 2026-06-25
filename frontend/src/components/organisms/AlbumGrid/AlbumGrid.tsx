import type { AlbumSummary } from '@/types/api';
import { AlbumCard } from '@/components/molecules/AlbumCard/AlbumCard';
import styles from './AlbumGrid.module.css';

/**
 * AlbumGrid organism (REQ-FE-009, DESIGN §7). Presentational wrapper: maps an
 * `AlbumSummary[]` to one `<AlbumCard>` per item. The page owns the TanStack
 * Query read; the grid owns the responsive layout. Forwards `onPlay` down so
 * the page can wire the queue seeding through AlbumCard's affordance.
 *
 * Composes the AlbumCard molecule only — no store reads (presentational).
 */
interface AlbumGridProps {
  albums: AlbumSummary[];
  onPlay?: (album: AlbumSummary) => void;
}

export function AlbumGrid({ albums, onPlay }: AlbumGridProps) {
  if (albums.length === 0) return null;
  return (
    <ul className={styles.grid} role="list">
      {albums.map((album) => (
        <li key={album.id}>
          <AlbumCard album={album} onPlay={onPlay} />
        </li>
      ))}
    </ul>
  );
}
