import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SearchBar } from '@/components/molecules/SearchBar/SearchBar';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import { TrackList } from '@/components/organisms/TrackList/TrackList';
import { AlbumGrid } from '@/components/organisms/AlbumGrid/AlbumGrid';
import { useSearch } from '@/features/search/hooks/use-search';
import { albumQueryOptions } from '@/features/catalog/hooks/use-album';
import { usePlayerStore } from '@/store/player.store';
import type {
  AlbumSummary,
  ArtistSummary,
  TrackPrimitive,
} from '@/types/api';
import styles from './SearchPage.module.css';

/**
 * Debounce window (ms) between the last keystroke and the committed query.
 * Mirrors AddTrackPicker's DEBOUNCE_MS (FE-PR5) so both search surfaces feel
 * identical: fast enough to be live, slow enough that "hello" is ONE search,
 * not six.
 */
const DEBOUNCE_MS = 300;

/**
 * SearchPage (REQ-FE-010, DESIGN §5.1). Live as-you-type search at parity
 * with the AddTrackPicker feel, with actionable results.
 *
 * URL contract — `?q=` stays the SHAREABLE committed query, but it is now the
 * page's OUTPUT, not its input trigger: seeded once on mount (deep links +
 * back-button entries), then WRITTEN by the page's own debounce/submit via
 * `setSearchParams(..., { replace: true })` so typing does NOT spam history
 * while the URL still reflects the active query for sharing.
 *
 * State pipeline (debounce lives HERE, in the container — the SearchBar
 * molecule stays presentational, its spec submit-only):
 *   term (input mirror, fires per keystroke)
 *     → 300ms cancellable debounce (AddTrackPicker pattern)
 *     → setSearchParams({q}, {replace:true})
 *     → q (derived from the URL) → useSearch(q) → grouped results
 * Enter short-circuits the window: submit commits the trimmed term at once
 * (the pending debounce timer is cancelled by the effect cleanup re-run).
 *
 * Three states per REQ-FE-010 (unchanged contract):
 *  - empty `q`        → intro state, NO backend request (useSearch `enabled`
 *                       is `q.length > 0` — scenario "Empty query does not
 *                       hit the backend").
 *  - `q` with matches → three sections, each listing its matches.
 *  - `q` no matches   → three EMPTY sections render WITHOUT error.
 * Plus the live state: while the user is typing (before the debounce
 * settles) or while `isLoading` with a non-empty q → Spinner.
 *
 * Results are actionable:
 *  - tracks → TrackList; a row click seeds the implicit queue with the
 *    RESULTS list via `playFromList(tracks, index)` (AlbumPage's wiring).
 *  - albums → AlbumGrid; a card play fetches the album detail (sharing the
 *    `['albums','detail',id]` cache with `useAlbum` through
 *    `albumQueryOptions`) then `playFromList(detail.tracks, 0)` — AlbumPage's
 *    "Play album" semantic adapted to a summary.
 *  - artists → Link rows to /artists/:id (navigation, not playback).
 */
export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const [term, setTerm] = useState(q);
  const { data, isLoading } = useSearch(q);
  const queryClient = useQueryClient();
  const playFromList = usePlayerStore((s) => s.playFromList);

  // Debounce — CANCELLED on every keystroke and on unmount (AddTrackPicker
  // pattern: the cleanup clears the pending timeout, so a stale query never
  // commits). The `q` guard skips the mount render (nothing new to commit —
  // also spares a redundant REPLACE navigation) and whitespace-only edits
  // (trim() === q ⇒ no re-search for a trailing space).
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed === q) return;
    const timer = window.setTimeout(
      () =>
        setSearchParams(
          trimmed.length > 0 ? { q: trimmed } : {},
          { replace: true },
        ),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [term, q, setSearchParams]);

  // Enter flushes the debounce: the trimmed term commits NOW (the effect
  // re-run above finds trimmed === q, so no second write happens).
  const handleSubmit = (t: string) => {
    setTerm(t);
    setSearchParams(t.length > 0 ? { q: t } : {}, { replace: true });
  };

  // True between the last keystroke and the commit — keeps the Spinner up
  // for the WHOLE live cycle (typing + fetch), not just the fetch.
  const isTyping = term.trim() !== q;

  // TrackSummary (search projection) carries NO trackNumber (read-models
  // asymmetry — search hits are album-agnostic). TrackRow's number slot
  // shows the POSITION IN THE RESULTS: the honest number for a search hit,
  // never an invented album track number.
  const tracks: TrackPrimitive[] = (data?.tracks ?? []).map((t, index) => ({
    ...t,
    trackNumber: index + 1,
  }));

  // Implicit-queue contract (DESIGN §7): the clicked list becomes the queue.
  const handlePlayTrack = (_track: TrackPrimitive, index: number) => {
    playFromList(tracks, index);
  };

  // "Play album" from a SUMMARY: the detail's tracks become the queue
  // (AlbumPage's `playFromList(data.tracks, 0)`). `fetchQuery` shares the
  // `['albums','detail',id]` cache with `useAlbum` via `albumQueryOptions`
  // (single source of truth — FE-PR5 precedent); its rejection routes
  // through `QueryCache.onError` → the app toast seam (verified: query-core
  // calls `cache.config.onError` on EVERY `Query#fetch` error), so the local
  // catch only keeps the promise settled — it must NOT re-toast (that would
  // double-route the failure).
  const handlePlayAlbum = (album: AlbumSummary) => {
    void queryClient
      .fetchQuery(albumQueryOptions(album.id))
      .then((detail) => playFromList(detail.tracks, 0))
      .catch(() => {
        /* surfaced once by QueryCache.onError (app toast) — see above */
      });
  };

  return (
    <section className={styles.page}>
      <h1 className={styles.heading}>Search</h1>
      <SearchBar
        initialValue={q}
        onChange={setTerm}
        onSubmit={handleSubmit}
      />

      {q.length === 0 && !isTyping ? (
        // REQ-FE-010 scenario "Empty query does not hit the backend".
        <p className={styles.intro}>Search for songs, artists, or albums.</p>
      ) : isTyping || isLoading ? (
        <Spinner aria-label="Searching" />
      ) : (
        <div className={styles.groups}>
          <ArtistsGroup artists={data?.artists ?? []} />
          <AlbumsGroup albums={data?.albums ?? []} onPlay={handlePlayAlbum} />
          <TracksGroup tracks={tracks} onPlay={handlePlayTrack} />
        </div>
      )}
    </section>
  );
}

/**
 * Each group always renders its header (REQ-FE-010 scenario "No matches
 * renders three empty groups") — the section is the contract, not the items.
 * The empty-group copy is the section-level "No <kind> found." state; the
 * organisms (AlbumGrid/TrackList) render null on empty arrays themselves.
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
              <Link to={`/artists/${a.id}`} className={styles.artistRow}>
                {a.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Albums render through the app-wide AlbumGrid/AlbumCard organism. */
function AlbumsGroup({
  albums,
  onPlay,
}: {
  albums: AlbumSummary[];
  onPlay: (album: AlbumSummary) => void;
}) {
  return (
    <section className={styles.group} aria-labelledby="search-albums">
      <h2 id="search-albums" className={styles.groupHeading}>
        Albums
      </h2>
      {albums.length === 0 ? (
        <p className={styles.empty}>No albums found.</p>
      ) : (
        <AlbumGrid albums={albums} onPlay={onPlay} />
      )}
    </section>
  );
}

/** Tracks render through the app-wide TrackList organism (playable rows). */
function TracksGroup({
  tracks,
  onPlay,
}: {
  tracks: TrackPrimitive[];
  onPlay: (track: TrackPrimitive, index: number) => void;
}) {
  return (
    <section className={styles.group} aria-labelledby="search-tracks">
      <h2 id="search-tracks" className={styles.groupHeading}>
        Tracks
      </h2>
      {tracks.length === 0 ? (
        <p className={styles.empty}>No tracks found.</p>
      ) : (
        <TrackList tracks={tracks} onPlay={onPlay} />
      )}
    </section>
  );
}
