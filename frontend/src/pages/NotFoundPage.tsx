import { Link } from 'react-router-dom';
import styles from './NotFoundPage.module.css';

/**
 * NotFoundPage (REQ-FE-009). Honest 404 for content misses.
 *
 * Presentational + composable: AlbumPage/ArtistPage render this INLINE when
 * their detail query returns `NOT_FOUND` (no crash, no raw error). Also
 * available as a routed fallback element. The default message is friendly
 * ("We couldn't find that"); pages can pass a context-specific `message`.
 */
interface NotFoundPageProps {
  message?: string;
}

export function NotFoundPage({ message }: NotFoundPageProps) {
  return (
    <div className={styles.notFound} role="alert">
      <p className={styles.message}>{message ?? "We couldn't find that"}</p>
      <Link to="/home" className={styles.homeLink}>
        Back to Home
      </Link>
    </div>
  );
}
