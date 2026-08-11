import type { PlaylistSummary } from '@/types/api';
import { PlaylistCard } from '@/components/molecules/PlaylistCard/PlaylistCard';
import styles from './PlaylistGrid.module.css';

/**
 * PlaylistGrid organism (REQ-FE-014, DESIGN §7). Presentational wrapper: maps
 * a `PlaylistSummary[]` to one `<PlaylistCard>` per item. The page owns the
 * TanStack Query read + the empty-state copy; the grid owns the responsive
 * layout. Composes the PlaylistCard molecule only — no store reads.
 */
interface PlaylistGridProps {
  playlists: PlaylistSummary[];
}

export function PlaylistGrid({ playlists }: PlaylistGridProps) {
  if (playlists.length === 0) return null;
  return (
    <ul className={styles.grid} role="list">
      {playlists.map((playlist) => (
        <li key={playlist.id}>
          <PlaylistCard playlist={playlist} />
        </li>
      ))}
    </ul>
  );
}
