import { Link } from 'react-router-dom';
import type { AlbumSummary } from '@/types/api';
import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';
import styles from './AlbumCard.module.css';

/**
 * AlbumCard molecule (REQ-FE-009, DESIGN §7). Presentational wrapper over an
 * `AlbumSummary`: cover image + title + artist name, linking to /albums/:id.
 *
 * Composes atoms only (Button + Icon). Emits `onPlay(album)` upward — the
 * container page decides what seeding the queue means (playerStore.playFromList).
 * Reads NO store: the §3 architecture rule forbids molecules from importing
 * `store/`/`features/`/`pages/`; the page owns the query read + the store call.
 *
 * a11y: the cover `<img>` is decorative (empty alt) when no cover URL exists;
 * a descriptive alt is used otherwise. The card Link's accessible name is the
 * title; the play button is aria-labelled separately.
 */
interface AlbumCardProps {
  album: AlbumSummary;
  /** When provided, a play button renders and emits the album on click. */
  onPlay?: (album: AlbumSummary) => void;
}

export function AlbumCard({ album, onPlay }: AlbumCardProps) {
  const { id, title, coverUrl, artist } = album;
  return (
    <article className={styles.card}>
      <Link to={`/albums/${id}`} className={styles.link} aria-label={title}>
        <div className={styles.cover}>
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={`${title} cover`}
              className={styles.image}
              loading="lazy"
            />
          ) : (
            // No cover URL → decorative placeholder. Empty alt so the title
            // (rendered below) is the accessible name; the gradient background
            // (CSS) carries the visual affordance.
            <img alt="" className={styles.placeholder} />
          )}
        </div>
        <div className={styles.meta}>
          <span className={styles.title}>{title}</span>
          <span className={styles.artist}>{artist.name}</span>
        </div>
      </Link>
      {onPlay && (
        <Button
          variant="ghost"
          aria-label={`Play ${title}`}
          className={styles.play}
          onClick={(e) => {
            // Prevent the play click from bubbling into the card Link.
            e.preventDefault();
            e.stopPropagation();
            onPlay(album);
          }}
        >
          <Icon name="play" size={20} aria-hidden="true" />
        </Button>
      )}
    </article>
  );
}
