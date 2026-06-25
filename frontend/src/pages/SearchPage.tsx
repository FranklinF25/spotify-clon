import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SearchBar } from '@/components/molecules/SearchBar/SearchBar';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import { useSearch } from '@/features/search/hooks/use-search';
import type { AlbumSummary, ArtistSummary, TrackSummary } from '@/types/api';
import styles from './SearchPage.module.css';

/**
 * SearchPage (REQ-FE-010, DESIGN §5.1). Replaces the PR-3 placeholder.
 *
 * Reads `?q=` from the URL (shareable + back-button-friendly — the page
 * reads `q` from `useSearchParams`, NOT local component state), renders
 * the SearchBar pre-filled, calls `useSearch(q)`, and renders three grouped
 * sections (artists, albums, tracks).
 *
 * Three states per REQ-FE-010:
 *  - empty `q`        → intro state, NO backend request (useSearch `enabled`
 *                       is `q.length > 0`).
 *  - `q` with matches → three sections, each listing its matches.
 *  - `q` no matches   → three EMPTY sections render WITHOUT error.
 *
 * The page is a CONTAINER (per the §5.1 container/presentational seam):
 * it owns the query read + the URL wiring. The molecules (AlbumCard,
 * TrackRow, SearchBar) stay presentational.
 */
export function SearchPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const { data, isLoading } = useSearch(q);

  return (
    <section className={styles.page}>
      <h1 className={styles.heading}>Search</h1>
      <SearchBar
        initialValue={q}
        onSubmit={(term) =>
          navigate(`/search?q=${encodeURIComponent(term)}`)
        }
      />

      {q.length === 0 ? (
        // REQ-FE-010 scenario "Empty query does not hit the backend".
        <p className={styles.intro}>Search for songs, artists, or albums.</p>
      ) : isLoading ? (
        <Spinner aria-label="Searching" />
      ) : (
        <div className={styles.groups}>
          <ArtistsGroup artists={data?.artists ?? []} />
          <AlbumsGroup albums={data?.albums ?? []} />
          <TracksGroup tracks={data?.tracks ?? []} />
        </div>
      )}
    </section>
  );
}

/**
 * Each group always renders its header (REQ-FE-010 scenario "No matches
 * renders three empty groups") — the section is the contract, not the items.
 */
function ArtistsGroup({ artists }: { artists: ArtistSummary[] }) {
  return (
    <section className={styles.group} aria-labelledby="search-artists">
      <h2 id="search-artists" className={styles.groupHeading}>
        Artists
      </h2>
      {artists.length === 0 ? (
        <p className={styles.empty}>No artists found.</p>
      ) : (
        <ul className={styles.list}>
          {artists.map((a) => (
            <li key={a.id}>
              <Link to={`/artists/${a.id}`}>{a.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AlbumsGroup({ albums }: { albums: AlbumSummary[] }) {
  return (
    <section className={styles.group} aria-labelledby="search-albums">
      <h2 id="search-albums" className={styles.groupHeading}>
        Albums
      </h2>
      {albums.length === 0 ? (
        <p className={styles.empty}>No albums found.</p>
      ) : (
        <ul className={styles.list}>
          {albums.map((a) => (
            <li key={a.id}>
              <Link to={`/albums/${a.id}`}>{a.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TracksGroup({ tracks }: { tracks: TrackSummary[] }) {
  return (
    <section className={styles.group} aria-labelledby="search-tracks">
      <h2 id="search-tracks" className={styles.groupHeading}>
        Tracks
      </h2>
      {tracks.length === 0 ? (
        <p className={styles.empty}>No tracks found.</p>
      ) : (
        <ul className={styles.list}>
          {tracks.map((t) => (
            <li key={t.id}>{t.title}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
