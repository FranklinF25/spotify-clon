import type { PlaylistPrimitive } from '@/types/api';
import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';
import styles from './PlaylistHeader.module.css';

/**
 * PlaylistHeader organism (REQ-FE-015, DESIGN §7).
 *
 * Presentational: renders a `PlaylistPrimitive` (title + createdAt metadata)
 * and the "Play playlist" button. The button delegates to the page's `onPlay`
 * handoff — the header owns NO store read, so it stays a pure presentational
 * seam (the page wires `playerStore.playFromList(tracks, 0)`).
 */
interface PlaylistHeaderProps {
  playlist: PlaylistPrimitive;
  onPlay: () => void;
}

export function PlaylistHeader({ playlist, onPlay }: PlaylistHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.cover} aria-hidden="true" />
      <div className={styles.meta}>
        <h1 className={styles.title}>{playlist.title}</h1>
        <p className={styles.subtitle}>
          {new Date(playlist.createdAt).toLocaleDateString()}
        </p>
        <Button variant="primary" aria-label="Play playlist" onClick={onPlay}>
          <Icon name="play" size={18} aria-hidden="true" /> Play
        </Button>
      </div>
    </header>
  );
}
