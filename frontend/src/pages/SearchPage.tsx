import { SearchBar } from '@/components/molecules/SearchBar/SearchBar';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styles from './SearchPage.module.css';

/**
 * SearchPage — TEMPORARY PLACEHOLDER (FE-PR3-11 route wiring).
 *
 * PR-3 registers the /search route so the Sidebar Search link + the SearchBar
 * navigation resolve. The real implementation (useSearch hook + grouped
 * results + empty/intro + no-match states) lands in FE-PR4-06 with its full
 * spec. This placeholder renders the SearchBar (so the route is live + the bar
 * is keyboard-operable) + an honest intro state — no fake results.
 */
export function SearchPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';

  return (
    <section className={styles.page}>
      <SearchBar initialValue={q} onSubmit={(term) => navigate(`/search?q=${encodeURIComponent(term)}`)} />
      <p className={styles.intro}>
        {q
          ? `Searching for “${q}” — results arrive with the player+search PR.`
          : 'Search for songs, artists, or albums.'}
      </p>
    </section>
  );
}
