import { Link } from 'react-router-dom';
import type { PlaylistSummary } from '@/types/api';
import styles from './PlaylistCard.module.css';

/**
 * PlaylistCard molecule (REQ-FE-014, DESIGN §7). Presentational wrapper over a
 * `PlaylistSummary`: title + createdAt, linking to /playlists/:id. Mirrors
 * AlbumCard. Composes atoms only; reads NO store (the page owns the query
 * read + the nav decision).
 */
interface PlaylistCardProps {
  playlist: PlaylistSummary;
}

export function PlaylistCard({ playlist }: PlaylistCardProps) {
  const { id, title, createdAt } = playlist;
  return (
    <article className={styles.card}>
      <Link to={`/playlists/${id}`} className={styles.link} aria-label={title}>
        <div className={styles.cover} aria-hidden="true" />
        <div className={styles.meta}>
          <span className={styles.title}>{title}</span>
          <span className={styles.date}>
            {new Date(createdAt).toLocaleDateString()}
          </span>
        </div>
      </Link>
    </article>
  );
}
